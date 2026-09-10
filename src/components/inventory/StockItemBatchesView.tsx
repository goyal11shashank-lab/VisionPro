import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  ArrowLeft, Search, Plus, RefreshCw, Barcode, Copy, Check, 
  Eye, Edit3, Trash2, BookOpen, AlertTriangle, ChevronLeft, ChevronRight,
  ShieldAlert, Sparkles, FileSpreadsheet, Calendar
} from 'lucide-react';
import { UniqueItem, OpticalBatch } from '../../types/index.js';
import { apiRequest } from '../../api/client.js';

interface StockItemBatchesViewProps {
  stockItem: UniqueItem;
  onBackToItems: () => void;
  onSelectBatch: (batch: any) => void;
  onOpenItemLedger: (item: UniqueItem) => void;
  onCreateBatch: () => void;
  onEditBatch: (batch: OpticalBatch) => void;
  onDeleteBatch: (batch: OpticalBatch) => void;
  onInspectBatch: (batch: OpticalBatch) => void;
  onOpenImportModal: () => void;
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
}) => {
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
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [copiedBarcode, setCopiedBarcode] = useState<string | null>(null);

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
  }, [stockItem.id, page, limit, statusFilter, search]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  const handleCopyBarcode = (barcode: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(barcode);
    setCopiedBarcode(barcode);
    setTimeout(() => setCopiedBarcode(null), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Breadcrumb & Top Bar */}
      <div className="flex items-center justify-between">
        <nav className="flex items-center gap-1.5 text-xs text-slate-500">
          <button
            onClick={onBackToItems}
            className="hover:text-blue-600 font-medium transition-colors"
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
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Stock Items</span>
        </button>
      </div>

      {/* Stock Item Header Info Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">{stockItem.name}</h1>
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
            <p className="text-xs text-slate-500 mt-1">
              Select any batch power to drill down into its month-wise summary and individual transaction vouchers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onOpenItemLedger(stockItem)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors shadow-sm"
              title="View full item ledger across all batches"
            >
              <BookOpen className="h-4 w-4" />
              <span>Stock Item Ledger</span>
            </button>

            <button
              onClick={onOpenImportModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors shadow-sm"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Bulk Import</span>
            </button>

            <button
              onClick={onCreateBatch}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>Create Batch</span>
            </button>
          </div>
        </div>

        {/* Aggregated Totals */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Batches Defined</span>
            <span className="text-lg font-mono font-bold text-slate-900">{totals.batchesCount}</span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Stock</span>
            <span className={`text-lg font-mono font-bold ${totals.stock < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
              {totals.stock} {stockItem.unit || 'PRS'}
            </span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Reserved</span>
            <span className="text-lg font-mono font-bold text-amber-700">{totals.reserved} {stockItem.unit || 'PRS'}</span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Available</span>
            <span className={`text-lg font-mono font-bold ${totals.available < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
              {totals.available} {stockItem.unit || 'PRS'}
            </span>
          </div>
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search power or barcode (e.g. '25 1' for -2.50/-1.00 or '890000000001')..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
          />
          {search && (
            <button
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
              className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600 font-medium"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value as any);
              setPage(1);
            }}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
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
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-slate-700 focus:outline-none"
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>

          <button
            onClick={fetchBatches}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            title="Refresh batches"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Batches Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 uppercase font-semibold text-[11px] tracking-wider">
              <tr>
                <th className="py-3 px-4">Batch / Power</th>
                <th className="py-3 px-3">Barcode</th>
                <th className="py-3 px-3 text-center">Side</th>
                <th className="py-3 px-3 text-right">Stock</th>
                <th className="py-3 px-3 text-right">Reserved</th>
                <th className="py-3 px-3 text-right">Available</th>
                <th className="py-3 px-3">Last Movement</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading && batches.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-500">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700 mb-2"></div>
                    <p className="text-xs font-medium">Loading batches for {stockItem.name}...</p>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-rose-600">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-rose-500" />
                    <p className="font-semibold text-xs">{error}</p>
                  </td>
                </tr>
              ) : batches.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400">
                    <Barcode className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600">No batches defined for this Stock Item</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {search ? 'No batches match your search filter.' : 'Click "Create Batch" or "Bulk Import" to define optical powers.'}
                    </p>
                  </td>
                </tr>
              ) : (
                (batches || []).map(batch => {
                  const stockNum = Number(batch.stock || 0);
                  const reservedNum = Number(batch.reserved || 0);
                  const availableNum = Number(batch.available || 0);

                  return (
                    <tr
                      key={batch.id}
                      onClick={() => onSelectBatch(batch)}
                      className="hover:bg-blue-50/40 transition-colors cursor-pointer group"
                    >
                      {/* Batch / Power (Canonical optical format) */}
                      <td className="py-3 px-4">
                        <div className="font-mono font-bold text-slate-900 text-sm group-hover:text-blue-700 transition-colors">
                          {batch.formattedName || '0.00 / 0.00'}
                        </div>
                        {batch.identityKey && (
                          <div className="text-[10px] text-slate-400 font-mono truncate max-w-[200px]" title={batch.identityKey}>
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
                            className="text-slate-400 hover:text-slate-700 p-0.5 rounded hover:bg-slate-200 transition-colors"
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

                      {/* Side */}
                      <td className="py-3 px-3 text-center font-mono text-slate-600">
                        {batch.side && batch.side !== 'NONE' ? (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-semibold text-[10px]">
                            {batch.side}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Stock */}
                      <td className={`py-3 px-3 text-right font-mono font-bold ${
                        stockNum < 0 ? 'text-rose-600 bg-rose-50/30' : 'text-slate-900'
                      }`}>
                        {stockNum}
                      </td>

                      {/* Reserved */}
                      <td className="py-3 px-3 text-right font-mono font-semibold text-amber-700">
                        {reservedNum > 0 ? reservedNum : '0'}
                      </td>

                      {/* Available */}
                      <td className={`py-3 px-3 text-right font-mono font-bold ${
                        availableNum < 0 ? 'text-rose-600 bg-rose-50/30' : 'text-emerald-700'
                      }`}>
                        {availableNum}
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
                      <td className="py-3 px-4 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onSelectBatch(batch)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors"
                            title="Open Batch Movement Ledger"
                          >
                            <BookOpen className="h-3.5 w-3.5" />
                            <span>Ledger</span>
                          </button>

                          <button
                            onClick={() => onEditBatch(batch)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Edit Batch Power"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>

                          <button
                            onClick={() => onDeleteBatch(batch)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
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
                className="p-1.5 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-medium text-slate-700">
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="p-1.5 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
