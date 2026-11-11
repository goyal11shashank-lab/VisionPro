import React, { useState, useEffect } from 'react';
import {
  Search,
  Store,
  Boxes,
  ShieldAlert,
  RefreshCw,
  X,
  Filter,
  CheckCircle,
  AlertCircle,
  Eye,
  Info,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';

interface StockFeedItem {
  batchId: string;
  barcode: string;
  identityKey: string;
  sph: string | number;
  cyl: string | number;
  axis: string | number;
  add: string | number;
  side: string;
  formattedPower: string;
  uniqueItemId: string;
  uniqueItemName: string;
  uniqueItemCode: string;
  categoryName: string;
  physicalStock: number;
  reservedStock: number;
  availableStock: number;
}

export const MainWarehouseStockSearchPage: React.FC = () => {
  const { user, currentBusiness } = useAuth();
  const [items, setItems] = useState<StockFeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Power search filters
  const [sph, setSph] = useState('');
  const [cyl, setCyl] = useState('');
  const [axis, setAxis] = useState('');
  const [add, setAdd] = useState('');
  const [side, setSide] = useState<'NONE' | 'R' | 'L' | 'BE'>('NONE');
  const [shorthandPower, setShorthandPower] = useState('');

  // Handle shorthand optical power conversion (e.g. 250100 -> -2.50 / -1.00)
  const handleApplyShorthand = () => {
    const raw = shorthandPower.replace(/[^0-9+-]/g, '');
    if (raw.length >= 4) {
      // First 2-3 digits SPH, next 2 digits CYL
      let sphPart = '';
      let cylPart = '';
      if (raw.length === 6) {
        sphPart = raw.slice(0, 3);
        cylPart = raw.slice(3);
      } else if (raw.length === 5) {
        sphPart = raw.slice(0, 3);
        cylPart = raw.slice(3);
      } else {
        sphPart = raw.slice(0, 2);
        cylPart = raw.slice(2);
      }

      const sphNum = (parseFloat(sphPart) / 100).toFixed(2);
      const cylNum = (parseFloat(cylPart) / 100).toFixed(2);
      setSph(sphNum);
      setCyl(cylNum);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('q', searchQuery.trim());
      if (sph.trim()) params.append('sph', sph.trim());
      if (cyl.trim()) params.append('cyl', cyl.trim());
      if (axis.trim()) params.append('axis', axis.trim());
      if (add.trim()) params.append('add', add.trim());
      if (side !== 'NONE') params.append('side', side);

      const res = await fetch(`/api/godowns/main-warehouse-stock?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch (err) {
      console.error('Failed to search main warehouse stock', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSph('');
    setCyl('');
    setAxis('');
    setAdd('');
    setSide('NONE');
    setShorthandPower('');
    setItems([]);
  };

  useEffect(() => {
    // Initial fetch of popular/available items
    handleSearch();
  }, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Banner: Restricted Read-Only Stock Feed */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="relative z-10 space-y-2">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/30 text-blue-200 border border-blue-400/30 uppercase tracking-wider">
              Restricted Read-Only Stock Feed
            </span>
            {user?.assignedGodown && (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/30 text-amber-200 border border-amber-400/30">
                Staff: {user.assignedGodown.name}
              </span>
            )}
          </div>
          <h1 className="text-xl font-bold tracking-tight">
            Main Warehouse Inventory Availability
          </h1>
          <p className="text-xs text-blue-200 max-w-2xl leading-relaxed">
            Live stock feed from the central Main Warehouse. Stock balances show physical, reserved, and available quantities.
            Prices, margin rates, and supplier identities are strictly protected and omitted.
          </p>
        </div>
      </div>

      {/* Optical Power Search & Filter Form */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search Item Name, Lens Model, Barcode, or Specs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                <span>Search Stock</span>
              </button>
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Optical Matrix Filter Grid */}
          <div className="pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-blue-600" />
                Optical Power Parameters
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Shorthand (e.g. 250100)"
                  value={shorthandPower}
                  onChange={(e) => setShorthandPower(e.target.value)}
                  className="w-40 px-2 py-1 rounded-lg border border-slate-200 text-[11px] font-mono"
                />
                <button
                  type="button"
                  onClick={handleApplyShorthand}
                  className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-700 cursor-pointer"
                >
                  Apply
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">SPH</label>
                <input
                  type="text"
                  placeholder="e.g. -2.50"
                  value={sph}
                  onChange={(e) => setSph(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">CYL</label>
                <input
                  type="text"
                  placeholder="e.g. -1.00"
                  value={cyl}
                  onChange={(e) => setCyl(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">AXIS</label>
                <input
                  type="text"
                  placeholder="0 - 180"
                  value={axis}
                  onChange={(e) => setAxis(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">ADD</label>
                <input
                  type="text"
                  placeholder="e.g. +2.00"
                  value={add}
                  onChange={(e) => setAdd(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Side</label>
                <select
                  value={side}
                  onChange={(e) => setSide(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white"
                >
                  <option value="NONE">Any / NONE</option>
                  <option value="R">Right (R)</option>
                  <option value="L">Left (L)</option>
                  <option value="BE">Both Eyes (BE)</option>
                </select>
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-bold text-slate-800">
              Matching Main Warehouse Batches ({items.length})
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            Updated in real-time
          </span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-600 mx-auto mb-2" />
            <p className="text-xs text-slate-500">Searching Main Warehouse stock...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <Boxes className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-800">No Matching Batches Found</p>
            <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
              No items in the central Main Warehouse match the selected optical power criteria.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4">Item & Code</th>
                  <th className="py-2.5 px-3">Optical Power</th>
                  <th className="py-2.5 px-3">Side</th>
                  <th className="py-2.5 px-3">Barcode</th>
                  <th className="py-2.5 px-3 text-right">Physical Stock</th>
                  <th className="py-2.5 px-3 text-right">Reserved Stock</th>
                  <th className="py-2.5 px-4 text-right">Available Stock</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => {
                  const avail = Number(item.availableStock);
                  const isAvailable = avail > 0;
                  return (
                    <tr key={item.batchId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">{item.uniqueItemName}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {item.uniqueItemCode} • {item.categoryName}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-700">
                        {item.formattedPower}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                          {item.side}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                        {item.barcode}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-slate-800">
                        {Number(item.physicalStock).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-amber-600 font-medium">
                        {Number(item.reservedStock).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-emerald-600 text-sm">
                        {avail.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {isAvailable ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle className="w-3 h-3" />
                            In Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                            <AlertCircle className="w-3 h-3" />
                            Out of Stock
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
