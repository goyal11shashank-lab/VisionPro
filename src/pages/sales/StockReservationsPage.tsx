import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  BookmarkCheck, Plus, Search, RefreshCw, Trash2, AlertTriangle, 
  CheckCircle2, RotateCcw, XCircle, Eye, Edit3, Download, Barcode, 
  Layers, ChevronLeft, ChevronRight, Clock, ShieldAlert, ArrowRight, User
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';
import { formatQuantity } from '../../utils/numberFormatting.js';

interface ReservationItem {
  id: string;
  batchId: string;
  barcode: string;
  identityKey?: string;
  categoryName: string;
  primaryItemName?: string | null;
  uniqueItemName: string;
  sph: number;
  cyl: number;
  axis: number;
  add: number;
  side: string;
  quantity: number;
  status: 'ACTIVE' | 'RELEASED' | 'CONVERTED' | 'CANCELLED';
  referenceType: string;
  referenceId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: string;
  releasedAt?: string | null;
  convertedAt?: string | null;
  cancelledAt?: string | null;
  physicalStock?: number;
  reservedStock?: number;
  availableStock?: number;
}

interface StockReservationsPageProps {
  onNavigate?: (path: string) => void;
}

export const StockReservationsPage: React.FC<StockReservationsPageProps> = ({ onNavigate }) => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('sales:edit') || hasPermission('sales.edit') || hasPermission('inventory:edit') || hasPermission('master:edit');
  const canCreate = hasPermission('sales:create') || hasPermission('sales:edit') || hasPermission('inventory:create') || hasPermission('inventory:edit');
  const canDelete = hasPermission('sales:delete') || hasPermission('sales.delete') || hasPermission('inventory:delete') || hasPermission('inventory:edit');

  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [refTypeFilter, setRefTypeFilter] = useState<string>('ALL');

  // Pagination
  const [page, setPage] = useState<number>(1);
  const pageSize = 50;

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Feedback notifications
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string; details?: string[] } | null>(null);

  // Modals state
  // 1. View Details Modal
  const [viewingReservation, setViewingReservation] = useState<ReservationItem | null>(null);

  // 2. Edit Modal
  const [editingReservation, setEditingReservation] = useState<ReservationItem | null>(null);
  const [editQty, setEditQty] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editRefType, setEditRefType] = useState<string>('');
  const [editRefId, setEditRefId] = useState<string>('');
  const [editSubmitting, setEditSubmitting] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // 3. Single Delete Modal
  const [deletingReservation, setDeletingReservation] = useState<ReservationItem | null>(null);
  const [singleDeleting, setSingleDeleting] = useState<boolean>(false);
  const [singleDeleteError, setSingleDeleteError] = useState<string | null>(null);

  // 4. Bulk Delete Modal
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState<boolean>(false);
  const [bulkDeleting, setBulkDeleting] = useState<boolean>(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [bulkDeleteResult, setBulkDeleteResult] = useState<any | null>(null);

  // 5. Create Reservation Modal
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [createBatchBarcode, setCreateBatchBarcode] = useState<string>('');
  const [createFoundBatch, setCreateFoundBatch] = useState<any | null>(null);
  const [createSearchingBatch, setCreateSearchingBatch] = useState<boolean>(false);
  const [createQty, setCreateQty] = useState<string>('1.00');
  const [createRefType, setCreateRefType] = useState<string>('MANUAL_HOLD');
  const [createRefId, setCreateRefId] = useState<string>('');
  const [createNotes, setCreateNotes] = useState<string>('');
  const [createSubmitting, setCreateSubmitting] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Fetch reservations
  const fetchReservations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      params.append('limit', '100');

      const res = await apiRequest<{ items: ReservationItem[]; total: number }>(
        `/api/inventory/reservations?${params.toString()}`
      );
      setReservations(res.items || []);
    } catch (err: any) {
      console.error('[FetchReservations Error]', err);
      setError(err.message || 'Failed to fetch stock reservations');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  // Filtering
  const filteredReservations = useMemo(() => {
    return reservations.filter(r => {
      if (refTypeFilter !== 'ALL' && r.referenceType !== refTypeFilter) return false;

      if (search.trim()) {
        const s = search.trim().toLowerCase();
        const matchesBarcode = r.barcode.toLowerCase().includes(s);
        const matchesItem = r.uniqueItemName.toLowerCase().includes(s);
        const matchesCategory = r.categoryName.toLowerCase().includes(s);
        const matchesNotes = r.notes?.toLowerCase().includes(s);
        const matchesRefId = r.referenceId?.toLowerCase().includes(s);
        const matchesPower = `${r.sph}`.includes(s) || `${r.cyl}`.includes(s);

        if (!matchesBarcode && !matchesItem && !matchesCategory && !matchesNotes && !matchesRefId && !matchesPower) {
          return false;
        }
      }

      return true;
    });
  }, [reservations, refTypeFilter, search]);

  // Aggregated Summary Metrics
  const metrics = useMemo(() => {
    let activeCount = 0;
    let activeQuantity = 0;
    let convertedCount = 0;
    let releasedOrCancelledCount = 0;

    reservations.forEach(r => {
      if (r.status === 'ACTIVE') {
        activeCount++;
        activeQuantity += Number(r.quantity) || 0;
      } else if (r.status === 'CONVERTED') {
        convertedCount++;
      } else if (r.status === 'RELEASED' || r.status === 'CANCELLED') {
        releasedOrCancelledCount++;
      }
    });

    return {
      activeCount,
      activeQuantity,
      convertedCount,
      releasedOrCancelledCount,
      totalCount: reservations.length,
    };
  }, [reservations]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredReservations.length / pageSize));
  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredReservations.slice(start, start + pageSize);
  }, [filteredReservations, page, pageSize]);

  // Selection
  const allVisibleSelected = useMemo(() => {
    return paginatedItems.length > 0 && paginatedItems.every(r => selectedIds.has(r.id));
  }, [paginatedItems, selectedIds]);

  const someVisibleSelected = useMemo(() => {
    return paginatedItems.some(r => selectedIds.has(r.id));
  }, [paginatedItems, selectedIds]);

  const isIndeterminate = someVisibleSelected && !allVisibleSelected;

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
  const handleOpenEdit = (resItem: ReservationItem) => {
    setEditingReservation(resItem);
    setEditQty(resItem.quantity.toString());
    setEditNotes(resItem.notes || '');
    setEditRefType(resItem.referenceType || 'MANUAL_HOLD');
    setEditRefId(resItem.referenceId || '');
    setEditError(null);
  };

  // Submit Edit
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReservation) return;

    const parsedQty = parseFloat(editQty);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      setEditError('Reserved quantity must be a positive number.');
      return;
    }

    try {
      setEditSubmitting(true);
      setEditError(null);

      const res = await apiRequest<{ success: boolean; reservation: ReservationItem; message: string }>(
        `/api/inventory/reservations/${editingReservation.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            quantity: parsedQty,
            notes: editNotes.trim() || null,
            referenceType: editRefType,
            referenceId: editRefId.trim() || null,
          }),
        }
      );

      setReservations(prev => prev.map(r => r.id === editingReservation.id ? { ...r, ...res.reservation } : r));
      setEditingReservation(null);
      setFeedback({
        type: 'success',
        text: `Stock Reservation #${editingReservation.id.slice(0, 8)} updated successfully.`,
      });
      setTimeout(() => setFeedback(null), 5000);
    } catch (err: any) {
      setEditError(err.message || 'Failed to update reservation');
    } finally {
      setEditSubmitting(false);
    }
  };

  // Release Action
  const handleRelease = async (resItem: ReservationItem) => {
    try {
      const res = await apiRequest<{ success: boolean; message?: string }>(
        `/api/inventory/reservations/${resItem.id}/release`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: 'Manual hold released from Sales Reservations page' }),
        }
      );

      setReservations(prev => prev.map(r => r.id === resItem.id ? { ...r, status: 'RELEASED', releasedAt: new Date().toISOString() } : r));
      setFeedback({
        type: 'success',
        text: `Stock Reservation for ${resItem.barcode} released successfully. Available inventory restored.`,
      });
      setTimeout(() => setFeedback(null), 5000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err.message || 'Failed to release reservation',
      });
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  // Single Delete
  const handleConfirmSingleDelete = async () => {
    if (!deletingReservation) return;
    try {
      setSingleDeleting(true);
      setSingleDeleteError(null);

      const res = await apiRequest<{ success: boolean; message: string }>(
        `/api/inventory/reservations/${deletingReservation.id}`,
        { method: 'DELETE' }
      );

      setReservations(prev => prev.filter(r => r.id !== deletingReservation.id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(deletingReservation.id);
        return next;
      });
      setDeletingReservation(null);
      setFeedback({
        type: 'success',
        text: res.message || 'Stock reservation deleted successfully.',
      });
      setTimeout(() => setFeedback(null), 5000);
    } catch (err: any) {
      setSingleDeleteError(err.message || 'Failed to delete reservation');
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
      }>('/api/inventory/reservations/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });

      if (res.deletedCount > 0 && res.failedCount === 0) {
        const deletedSet = new Set(ids);
        setReservations(prev => prev.filter(r => !deletedSet.has(r.id)));
        setShowBulkDeleteModal(false);
        setSelectedIds(new Set());
        setFeedback({
          type: 'success',
          text: res.message || `Deleted ${res.deletedCount} reservation(s) and released associated inventory holds.`,
        });
        setTimeout(() => setFeedback(null), 6000);
      } else {
        setBulkDeleteResult(res);
        if (res.deletedCount > 0) {
          fetchReservations();
          setSelectedIds(new Set());
        }
      }
    } catch (err: any) {
      setBulkDeleteError(err.message || 'Failed to perform bulk delete of reservations');
    } finally {
      setBulkDeleting(false);
    }
  };

  // Create Reservation: Barcode search
  const handleSearchBatch = async () => {
    if (!createBatchBarcode.trim()) return;
    try {
      setCreateSearchingBatch(true);
      setCreateError(null);
      const res = await apiRequest<{ success: boolean; batch: any }>(
        `/api/optical-master/batches/lookup?barcode=${encodeURIComponent(createBatchBarcode.trim().toUpperCase())}`
      );
      if (res.batch) {
        setCreateFoundBatch(res.batch);
      } else {
        setCreateError(`Batch with barcode "${createBatchBarcode}" not found.`);
      }
    } catch (err: any) {
      setCreateError(err.message || 'Batch lookup failed');
    } finally {
      setCreateSearchingBatch(false);
    }
  };

  // Submit Create Reservation
  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createFoundBatch) {
      setCreateError('Please lookup and verify an optical batch barcode first.');
      return;
    }

    const qty = parseFloat(createQty);
    if (isNaN(qty) || qty <= 0) {
      setCreateError('Quantity must be greater than 0.');
      return;
    }

    const avail = Number(createFoundBatch.availableStock ?? createFoundBatch.available ?? 0);
    if (qty > avail) {
      setCreateError(`Insufficient available stock (${avail} prs). Requested: ${qty} prs.`);
      return;
    }

    try {
      setCreateSubmitting(true);
      setCreateError(null);

      const res = await apiRequest<any>('/api/inventory/reservations', {
        method: 'POST',
        body: JSON.stringify({
          batchId: createFoundBatch.id,
          quantity: qty,
          referenceType: createRefType,
          referenceId: createRefId.trim() || undefined,
          notes: createNotes.trim() || undefined,
        }),
      });

      setShowCreateModal(false);
      setCreateBatchBarcode('');
      setCreateFoundBatch(null);
      setCreateQty('1.00');
      setCreateNotes('');
      setCreateRefId('');
      setFeedback({
        type: 'success',
        text: `Stock Reservation created successfully for ${createFoundBatch.barcode} (${qty} prs held).`,
      });
      setTimeout(() => setFeedback(null), 5000);
      fetchReservations();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create reservation');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleExportCSV = () => {
    const headers = [
      'Reservation ID', 'Barcode', 'Power SPH/CYL', 'Stock Item', 'Category', 
      'Quantity (prs)', 'Status', 'Reference Type', 'Reference ID', 'Notes', 'Created At'
    ];
    const rows = filteredReservations.map(r => [
      r.id,
      r.barcode,
      `${r.sph} / ${r.cyl}`,
      r.uniqueItemName,
      r.categoryName,
      r.quantity,
      r.status,
      r.referenceType,
      r.referenceId || '',
      r.notes || '',
      r.createdAt,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(row => row.map(c => `"${c}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Stock_Reservations_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <BookmarkCheck className="h-6 w-6 text-blue-600" />
              Stock Reservations
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              Sales Holds &amp; Allocations
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Track active inventory commitments, dealer holds, and order reservations before invoice fulfillment.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchReservations()}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors cursor-pointer"
            title="Refresh Reservations"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl border border-slate-200 transition-colors cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </button>

          {canCreate && (
            <button
              onClick={() => {
                setShowCreateModal(true);
                setCreateError(null);
                setCreateFoundBatch(null);
                setCreateBatchBarcode('');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create Reservation</span>
            </button>
          )}
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Holds</span>
            <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-amber-700 font-mono">{metrics.activeCount}</span>
            <span className="text-xs text-slate-400">reservations</span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Reserved Volume</span>
            <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
              <Layers className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-blue-700 font-mono">{formatQuantity(metrics.activeQuantity)}</span>
            <span className="text-xs text-slate-400">pairs held</span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Converted (Delivered)</span>
            <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-700 font-mono">{metrics.convertedCount}</span>
            <span className="text-xs text-slate-400">invoiced</span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Released / Cancelled</span>
            <span className="p-1.5 rounded-lg bg-slate-50 text-slate-600">
              <RotateCcw className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-700 font-mono">{metrics.releasedOrCancelledCount}</span>
            <span className="text-xs text-slate-400">restored</span>
          </div>
        </div>
      </div>

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
                <ul className="mt-1 space-y-0.5 text-xs text-rose-700 list-disc list-inside">
                  {feedback.details.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              )}
            </div>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-600 p-1">&times;</button>
        </div>
      )}

      {/* Multi-Select Toolbar */}
      {selectedIds.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              {selectedIds.size}
            </span>
            <span className="text-xs font-semibold text-blue-900">
              {selectedIds.size === 1 ? '1 reservation selected' : `${selectedIds.size} reservations selected`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-white rounded-lg transition-colors cursor-pointer border border-slate-200 bg-white"
            >
              Deselect All
            </button>

            {canDelete && (
              <button
                type="button"
                id="btn-bulk-delete-reservations"
                onClick={() => {
                  setBulkDeleteError(null);
                  setBulkDeleteResult(null);
                  setShowBulkDeleteModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Selected ({selectedIds.size})</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filters & Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by Barcode, SPH, CYL, Item name, Notes, Order #..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
          </div>

          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="py-1.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-slate-700"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Holds</option>
            <option value="CONVERTED">Converted (Fulfilled)</option>
            <option value="RELEASED">Released</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <select
            value={refTypeFilter}
            onChange={e => { setRefTypeFilter(e.target.value); setPage(1); }}
            className="py-1.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-slate-700"
          >
            <option value="ALL">All References</option>
            <option value="MANUAL_HOLD">Manual Hold</option>
            <option value="SALES_ORDER">Sales Order</option>
            <option value="DEALER_ORDER">Dealer Order</option>
            <option value="CUSTOMER_HOLD">Customer Hold</option>
          </select>
        </div>
      </div>

      {/* Table */}
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
                    title="Select/Deselect visible reservations"
                  />
                </th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Barcode &amp; Power</th>
                <th className="py-3 px-3">Stock Item</th>
                <th className="py-3 px-3 text-right">Reserved (prs)</th>
                <th className="py-3 px-3">Reference</th>
                <th className="py-3 px-3">Notes</th>
                <th className="py-3 px-3">Created</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && reservations.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-500" />
                    <p className="text-xs font-semibold text-slate-600">Loading stock reservations...</p>
                  </td>
                </tr>
              ) : paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <BookmarkCheck className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600">No stock reservations found</p>
                    <p className="text-xs text-slate-400 mt-1">Try clearing your filters or create a new hold.</p>
                  </td>
                </tr>
              ) : (
                paginatedItems.map(item => {
                  const isSelected = selectedIds.has(item.id);
                  const isEditable = item.status === 'ACTIVE' && canEdit;
                  const isDeletable = canDelete;

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-blue-50/70 border-l-4 border-l-blue-600' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(item.id)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>

                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          item.status === 'ACTIVE'
                            ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                            : item.status === 'CONVERTED'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : item.status === 'RELEASED'
                            ? 'bg-slate-100 text-slate-600 border-slate-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}>
                          {item.status}
                        </span>
                      </td>

                      <td className="py-3 px-3 font-mono">
                        <div className="font-bold text-slate-900 text-xs">
                          {item.sph > 0 ? `+${item.sph.toFixed(2)}` : item.sph.toFixed(2)} / {item.cyl > 0 ? `+${item.cyl.toFixed(2)}` : item.cyl.toFixed(2)}
                          {item.axis ? <span className="ml-1 text-[10px] text-slate-500 font-normal">Ax:{item.axis}°</span> : null}
                          {item.add ? <span className="ml-1 text-[10px] text-slate-500 font-normal">Add:{item.add}</span> : null}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono inline-flex items-center gap-1 mt-0.5">
                          <Barcode className="h-3 w-3 text-slate-400" />
                          <span>{item.barcode}</span>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-800 truncate max-w-[200px]" title={item.uniqueItemName}>
                          {item.uniqueItemName}
                        </div>
                        <div className="text-[10px] text-slate-400 font-medium">
                          {item.categoryName}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        {formatQuantity(item.quantity)} prs
                      </td>

                      <td className="py-3 px-3">
                        <span className="font-semibold text-slate-700">{item.referenceType}</span>
                        {item.referenceId && (
                          <div className="text-[10px] text-slate-400 font-mono truncate max-w-[140px]" title={item.referenceId}>
                            Ref: {item.referenceId}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-slate-600 max-w-[180px] truncate" title={item.notes || ''}>
                        {item.notes || '—'}
                      </td>

                      <td className="py-3 px-3 text-slate-500 text-[11px] font-mono whitespace-nowrap">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setViewingReservation(item)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                            title="View Reservation Details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>

                          {isEditable && (
                            <button
                              onClick={() => handleOpenEdit(item)}
                              className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                              title="Edit Reservation"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                          )}

                          {item.status === 'ACTIVE' && canEdit && (
                            <button
                              onClick={() => handleRelease(item)}
                              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                              title="Release Reservation"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )}

                          {isDeletable && (
                            <button
                              onClick={() => {
                                setDeletingReservation(item);
                                setSingleDeleteError(null);
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Delete Reservation"
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

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <div>
              Showing <span className="font-semibold text-slate-900">{Math.min(filteredReservations.length, (page - 1) * pageSize + 1)}</span> to{' '}
              <span className="font-semibold text-slate-900">{Math.min(filteredReservations.length, page * pageSize)}</span> of{' '}
              <span className="font-semibold text-slate-900">{filteredReservations.length}</span> reservations
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

      {/* MODAL 1: View Reservation Details */}
      {viewingReservation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                  <BookmarkCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Stock Reservation Details</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">ID: {viewingReservation.id}</p>
                </div>
              </div>
              <button onClick={() => setViewingReservation(null)} className="text-slate-400 hover:text-slate-600 p-1">&times;</button>
            </div>

            <div className="space-y-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="text-slate-500">Status</span>
                <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                  viewingReservation.status === 'ACTIVE' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-800'
                }`}>
                  {viewingReservation.status}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500">Optical Batch Barcode</span>
                <span className="font-mono font-bold text-slate-900">{viewingReservation.barcode}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500">Power Parameters</span>
                <span className="font-mono font-bold text-blue-700">
                  SPH: {viewingReservation.sph > 0 ? `+${viewingReservation.sph.toFixed(2)}` : viewingReservation.sph.toFixed(2)} | CYL: {viewingReservation.cyl > 0 ? `+${viewingReservation.cyl.toFixed(2)}` : viewingReservation.cyl.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500">Stock Item</span>
                <span className="font-semibold text-slate-800">{viewingReservation.uniqueItemName}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500">Category</span>
                <span className="font-medium text-slate-700">{viewingReservation.categoryName}</span>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                <span className="text-slate-500 font-semibold">Reserved Quantity</span>
                <span className="font-mono font-bold text-slate-900 text-sm">{formatQuantity(viewingReservation.quantity)} prs</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500">Reference Type</span>
                <span className="font-semibold text-slate-800">{viewingReservation.referenceType}</span>
              </div>

              {viewingReservation.referenceId && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Reference ID / Doc</span>
                  <span className="font-mono text-slate-800">{viewingReservation.referenceId}</span>
                </div>
              )}

              {viewingReservation.notes && (
                <div className="pt-2 border-t border-slate-200">
                  <span className="text-slate-500 block mb-1">Notes / Customer:</span>
                  <p className="text-slate-700 bg-white p-2 rounded border border-slate-200">{viewingReservation.notes}</p>
                </div>
              )}

              <div className="pt-2 border-t border-slate-200 space-y-1 text-[11px] text-slate-500">
                <div>Created: {new Date(viewingReservation.createdAt).toLocaleString()}</div>
                {viewingReservation.releasedAt && <div>Released: {new Date(viewingReservation.releasedAt).toLocaleString()}</div>}
                {viewingReservation.convertedAt && <div>Converted: {new Date(viewingReservation.convertedAt).toLocaleString()}</div>}
                {viewingReservation.cancelledAt && <div>Cancelled: {new Date(viewingReservation.cancelledAt).toLocaleString()}</div>}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setViewingReservation(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Edit Reservation */}
      {editingReservation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl">
                  <Edit3 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Edit Stock Reservation</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">Barcode: {editingReservation.barcode}</p>
                </div>
              </div>
              <button onClick={() => setEditingReservation(null)} className="text-slate-400 hover:text-slate-600 p-1">&times;</button>
            </div>

            <form onSubmit={handleSubmitEdit} className="space-y-3.5">
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
                <span className="text-slate-500">Power:</span>{' '}
                <span className="font-mono font-bold text-slate-800">
                  {editingReservation.sph > 0 ? `+${editingReservation.sph.toFixed(2)}` : editingReservation.sph.toFixed(2)} / {editingReservation.cyl > 0 ? `+${editingReservation.cyl.toFixed(2)}` : editingReservation.cyl.toFixed(2)}
                </span>
                <span className="mx-2 text-slate-300">|</span>
                <span className="text-slate-500">Item:</span>{' '}
                <span className="font-semibold text-slate-800">{editingReservation.uniqueItemName}</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reserved Quantity (pairs) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={editQty}
                  onChange={e => setEditQty(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Increasing reserved quantity will verify that sufficient unreserved stock is available in this batch.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reference Type</label>
                <select
                  value={editRefType}
                  onChange={e => setEditRefType(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="MANUAL_HOLD">Manual Hold</option>
                  <option value="SALES_ORDER">Sales Order</option>
                  <option value="DEALER_ORDER">Dealer Order</option>
                  <option value="CUSTOMER_HOLD">Customer Hold</option>
                  <option value="PATIENT_HOLD">Patient Hold</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reference ID / Doc #</label>
                <input
                  type="text"
                  value={editRefId}
                  onChange={e => setEditRefId(e.target.value)}
                  placeholder="e.g. SO-2026-001 or Customer Name"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Instructions</label>
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder="Reason for hold or customer request..."
                  rows={2}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {editError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold">
                  {editError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingReservation(null)}
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

      {/* MODAL 3: Single Delete Reservation */}
      {deletingReservation && (
        <div id="modal-delete-reservation" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <Trash2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Stock Reservation</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">Barcode: {deletingReservation.barcode}</p>
                <p className="text-xs font-bold text-slate-800 mt-0.5">Quantity: {deletingReservation.quantity} pairs</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to delete this reservation?
              {deletingReservation.status === 'ACTIVE' ? (
                <span className="block mt-1.5 text-amber-700 font-semibold bg-amber-50 p-2 rounded-lg border border-amber-200">
                  Notice: Since this reservation is currently ACTIVE, deleting it will immediately release the {deletingReservation.quantity} held pairs back into available inventory.
                </span>
              ) : null}
            </p>

            {singleDeleteError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold">
                {singleDeleteError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeletingReservation(null)}
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

      {/* MODAL 4: Bulk Delete Reservations */}
      {showBulkDeleteModal && (
        <div id="modal-bulk-delete-reservations" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <Trash2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Delete {selectedIds.size} Selected Reservations
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Bulk removal and hold release from database
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              You are about to permanently delete <span className="font-bold text-slate-900">{selectedIds.size}</span> selected stock reservations.
              Any active holds among these reservations will automatically be released, restoring available stock levels in real time.
            </p>

            {bulkDeleteError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold">
                {bulkDeleteError}
              </div>
            )}

            {bulkDeleteResult && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
                <p className="font-semibold text-slate-800">{bulkDeleteResult.message}</p>
                {bulkDeleteResult.errors && bulkDeleteResult.errors.length > 0 && (
                  <ul className="list-disc list-inside text-rose-600 space-y-0.5 text-[11px]">
                    {bulkDeleteResult.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                  </ul>
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
                  id="btn-confirm-bulk-delete-reservations"
                  onClick={handleConfirmBulkDelete}
                  disabled={bulkDeleting || selectedIds.size === 0}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {bulkDeleting ? 'Deleting...' : `Confirm & Delete (${selectedIds.size})`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: Create New Reservation */}
      {showCreateModal && (
        <div id="modal-create-reservation" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                  <BookmarkCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Create Stock Reservation</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Hold batch inventory for an upcoming order or customer</p>
                </div>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600 p-1">&times;</button>
            </div>

            <form onSubmit={handleCreateReservation} className="space-y-3.5">
              {/* Batch lookup */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Optical Batch Barcode <span className="text-rose-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={createBatchBarcode}
                    onChange={e => setCreateBatchBarcode(e.target.value)}
                    placeholder="Enter or scan barcode..."
                    className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase"
                  />
                  <button
                    type="button"
                    onClick={handleSearchBatch}
                    disabled={createSearchingBatch || !createBatchBarcode.trim()}
                    className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg disabled:opacity-50 cursor-pointer"
                  >
                    {createSearchingBatch ? 'Searching...' : 'Lookup'}
                  </button>
                </div>
              </div>

              {/* Verified Batch Card */}
              {createFoundBatch && (
                <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-xs space-y-1 animate-in fade-in">
                  <div className="flex justify-between items-center font-bold text-slate-900">
                    <span>Power: {createFoundBatch.formattedName || `${createFoundBatch.sph} / ${createFoundBatch.cyl}`}</span>
                    <span className="font-mono text-blue-700">{createFoundBatch.barcode}</span>
                  </div>
                  <div className="text-slate-600">{createFoundBatch.uniqueItemName || createFoundBatch.name}</div>
                  <div className="flex justify-between items-center pt-1 border-t border-blue-200 font-mono text-[11px]">
                    <span className="text-slate-500">Physical: {createFoundBatch.physicalStock || 0}</span>
                    <span className="text-amber-700">Reserved: {createFoundBatch.reservedStock || 0}</span>
                    <span className="text-blue-700 font-bold">Available: {createFoundBatch.availableStock || 0} prs</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Quantity to Reserve (pairs) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={createQty}
                  onChange={e => setCreateQty(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reference Type</label>
                <select
                  value={createRefType}
                  onChange={e => setCreateRefType(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="MANUAL_HOLD">Manual Hold</option>
                  <option value="SALES_ORDER">Sales Order</option>
                  <option value="DEALER_ORDER">Dealer Order</option>
                  <option value="CUSTOMER_HOLD">Customer Hold</option>
                  <option value="PATIENT_HOLD">Patient Hold</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reference ID / Document #</label>
                <input
                  type="text"
                  value={createRefId}
                  onChange={e => setCreateRefId(e.target.value)}
                  placeholder="Optional reference number..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Customer / Notes</label>
                <textarea
                  value={createNotes}
                  onChange={e => setCreateNotes(e.target.value)}
                  placeholder="Reason or customer name..."
                  rows={2}
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
                  {createSubmitting ? 'Creating...' : 'Create Reservation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
