import React, { useState, useMemo } from 'react';
import { 
  Search, RefreshCw, Plus, FileSpreadsheet, BookOpen, Layers, 
  ChevronRight, AlertTriangle, CheckCircle2, ArrowRight, Eye, Boxes
} from 'lucide-react';
import { UniqueItem, Category } from '../../types/index.js';
import { rankSearchMatch } from '../../utils/searchNormalization.js';

interface StockItemsListViewProps {
  items: UniqueItem[];
  categories: Category[];
  loading: boolean;
  onRefresh: () => void;
  onSelectStockItem: (item: UniqueItem) => void;
  onOpenLedger: (item: UniqueItem) => void;
  onCreateBatch: () => void;
  onOpenImportModal: () => void;
}

export const StockItemsListView: React.FC<StockItemsListViewProps> = ({
  items = [],
  categories = [],
  loading,
  onRefresh,
  onSelectStockItem,
  onOpenLedger,
  onCreateBatch,
  onOpenImportModal,
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const safeItems = useMemo(() => Array.isArray(items) ? items : [], [items]);
  const safeCategories = useMemo(() => Array.isArray(categories) ? categories : [], [categories]);

  // Filter items by category first
  const categoryFiltered = useMemo(() => {
    if (!selectedCategory) return safeItems;
    return safeItems.filter(
      item => item.categoryId === selectedCategory || item.opticalCategory === selectedCategory || item.categoryCode === selectedCategory
    );
  }, [safeItems, selectedCategory]);

  // Apply symbol-insensitive search matching
  const filteredItems = useMemo(() => {
    if (!search.trim()) return categoryFiltered;
    return rankSearchMatch<UniqueItem>(categoryFiltered, search.trim(), (item: UniqueItem) => ({
      id: item.id,
      name: item.name,
      code: item.code,
      categoryCode: item.opticalCategory || item.categoryCode || '',
      rawText: `${item.name} ${item.code} ${item.description || ''} ${item.primaryItemName || ''}`,
    }));
  }, [categoryFiltered, search]);

  // Aggregated totals
  const totalStock = useMemo(() => safeItems.reduce((sum, item) => sum + (Number(item.stock) || 0), 0), [safeItems]);
  const totalReserved = useMemo(() => safeItems.reduce((sum, item) => sum + (Number(item.reserved) || 0), 0), [safeItems]);
  const totalAvailable = useMemo(() => safeItems.reduce((sum, item) => sum + (Number(item.available) || 0), 0), [safeItems]);
  const totalBatches = useMemo(() => safeItems.reduce((sum, item) => sum + (Number(item.batchesCount) || 0), 0), [safeItems]);

  return (
    <div className="space-y-4">
      {/* Top Banner & Action Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">Stock Items & Batch Powers</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                {safeItems.length} Stock Items
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Hierarchical optical catalog. Select any Stock Item to view its specific power batches and transaction ledger.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              title="Refresh inventory"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            </button>

            <button
              onClick={onOpenImportModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors shadow-sm"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Bulk Import Batches</span>
            </button>

            <button
              onClick={onCreateBatch}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>Add Optical Batch</span>
            </button>
          </div>
        </div>

        {/* Aggregate Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Total Batches</span>
            <span className="text-lg font-mono font-bold text-slate-900">{totalBatches}</span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Total Stock</span>
            <span className={`text-lg font-mono font-bold ${totalStock < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
              {totalStock} PRS
            </span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Reserved</span>
            <span className="text-lg font-mono font-bold text-amber-700">{totalReserved} PRS</span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Available</span>
            <span className={`text-lg font-mono font-bold ${totalAvailable < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
              {totalAvailable} PRS
            </span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search Stock Item name, code, or power (e.g. 'hc sv 62' or 'item-sv')..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600 font-medium"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          >
            <option value="">All Categories</option>
            {safeCategories.map(c => (
              <option key={c.id} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stock Items Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 uppercase font-semibold text-[11px] tracking-wider">
              <tr>
                <th className="py-3 px-4">Stock Item</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3">Unit</th>
                <th className="py-3 px-3 text-center">Maintain Batches</th>
                <th className="py-3 px-3 text-right">No. of Batches</th>
                <th className="py-3 px-3 text-right">Stock</th>
                <th className="py-3 px-3 text-right">Reserved</th>
                <th className="py-3 px-3 text-right">Available</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-500">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700 mb-2"></div>
                    <p className="text-xs font-medium">Loading optical stock items from database...</p>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400">
                    <Boxes className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600">No stock items found</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {search ? 'Try adjusting your search terms.' : 'Create a Stock Item or import batch data to get started.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredItems.map(item => {
                  const stockNum = Number(item.stock || 0);
                  const reservedNum = Number(item.reserved || 0);
                  const availableNum = Number(item.available || 0);
                  const bCount = Number(item.batchesCount || 0);

                  return (
                    <tr
                      key={item.id}
                      onClick={() => onSelectStockItem(item)}
                      className="hover:bg-blue-50/40 transition-colors cursor-pointer group"
                    >
                      {/* Stock Item Name & Code */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors flex items-center gap-1.5">
                          <span>{item.name}</span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {item.code}
                        </div>
                      </td>

                      {/* Category */}
                      <td className="py-3 px-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          {item.opticalCategory || item.categoryCode || 'SV'}
                        </span>
                      </td>

                      {/* Unit */}
                      <td className="py-3 px-3 font-mono text-slate-600">
                        {item.unit || 'PRS'}
                      </td>

                      {/* Maintain Batches */}
                      <td className="py-3 px-3 text-center">
                        {item.maintainBatches !== false ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>YES</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">
                            NO
                          </span>
                        )}
                      </td>

                      {/* No. of Batches */}
                      <td className="py-3 px-3 text-right font-mono font-semibold text-slate-800">
                        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-100">
                          {bCount}
                        </span>
                      </td>

                      {/* Stock */}
                      <td className={`py-3 px-3 text-right font-mono font-bold ${
                        stockNum < 0 ? 'text-rose-600 bg-rose-50/40' : 'text-slate-900'
                      }`}>
                        {stockNum}
                      </td>

                      {/* Reserved */}
                      <td className="py-3 px-3 text-right font-mono font-semibold text-amber-700">
                        {reservedNum > 0 ? reservedNum : '0'}
                      </td>

                      {/* Available */}
                      <td className={`py-3 px-3 text-right font-mono font-bold ${
                        availableNum < 0 ? 'text-rose-600 bg-rose-50/40' : 'text-emerald-700'
                      }`}>
                        {availableNum}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onOpenLedger(item)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                            title="View Stock Item Ledger (Monthly & Transactions)"
                          >
                            <BookOpen className="h-4 w-4" />
                          </button>

                          <button
                            onClick={() => onSelectStockItem(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                          >
                            <span>Batches ({bCount})</span>
                            <ChevronRight className="h-3.5 w-3.5" />
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
      </div>
    </div>
  );
};
