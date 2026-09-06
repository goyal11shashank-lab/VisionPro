import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Calendar,
  Download,
  Filter,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  FileText,
  Clock,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Layers,
  Sparkles,
  Barcode,
  Info,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';

export interface MonthlySummary {
  month: string;
  monthLabel: string;
  openingQty: number;
  purchaseQty: number;
  purchaseValue: number;
  salesQty: number;
  salesValue: number;
  returnIn: number;
  returnOut: number;
  adjustment: number;
  openingStockEntry: number;
  closingQty: number;
  transactionCount: number;
}

export interface StockTransaction {
  id: string;
  date: string;
  transactionType: string;
  transactionLabel: string;
  direction: 'IN' | 'OUT' | 'NEUTRAL';
  voucherNo: string;
  voucherId: string | null;
  partyName: string;
  partyId: string | null;
  quantityIn: number;
  quantityOut: number;
  rate: number;
  value: number;
  runningBalance: number;
  batchId: string | null;
  barcode: string | null;
  sph: number | null;
  cyl: number | null;
  axis: number | null;
  add: number | null;
  notes: string | null;
}

export interface StockItemLedgerData {
  item: {
    id: string;
    name: string;
    code: string;
    description: string | null;
    purchaseRate: number;
    lastPurchasePrice: number;
    mrp: number;
    status: string;
    primaryItemName: string | null;
    categoryCode: string | null;
  };
  stockSummary: {
    physicalStock: number;
    reservedStock: number;
    availableStock: number;
    totalPurchasedQty: number;
    totalPurchasedValue: number;
    totalSoldQty: number;
    totalSoldValue: number;
    openingBalance: number;
    closingBalance: number;
  };
  monthlySummaries: MonthlySummary[];
  transactions: StockTransaction[];
}

interface StockItemLedgerModalProps {
  itemId: string | null;
  itemName?: string;
  onClose: () => void;
}

export const StockItemLedgerModal: React.FC<StockItemLedgerModalProps> = ({
  itemId,
  itemName,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledgerData, setLedgerData] = useState<StockItemLedgerData | null>(null);

  // View mode: 'monthly' (Tally Month-wise) or 'transactions' (Voucher Level)
  const [activeView, setActiveView] = useState<'monthly' | 'transactions'>('monthly');

  // Filters
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [searchFilter, setSearchFilter] = useState('');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('ALL');

  useEffect(() => {
    if (itemId) {
      fetchLedger();
    }
  }, [itemId]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const fetchLedger = async () => {
    if (!itemId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<{ success: boolean; data: StockItemLedgerData }>(
        `/api/stock-items/${itemId}/ledger`
      );
      setLedgerData(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load stock item ledger');
    } finally {
      setLoading(false);
    }
  };

  // Distinct power batches for filtering
  const distinctBatches = useMemo(() => {
    if (!ledgerData?.transactions) return [];
    const map = new Map<string, { id: string; barcode: string; sph: number; cyl: number }>();
    for (const t of ledgerData.transactions) {
      if (t.batchId && t.barcode) {
        map.set(t.batchId, {
          id: t.batchId,
          barcode: t.barcode,
          sph: t.sph ?? 0,
          cyl: t.cyl ?? 0,
        });
      }
    }
    return Array.from(map.values());
  }, [ledgerData]);

  // Filtered transactions
  const filteredTransactions = useMemo(() => {
    if (!ledgerData?.transactions) return [];
    return ledgerData.transactions.filter(t => {
      // Month filter
      if (selectedMonth !== 'ALL') {
        const tMonth = t.date.slice(0, 7);
        if (tMonth !== selectedMonth) return false;
      }
      // Direction filter
      if (directionFilter === 'IN' && t.direction !== 'IN') return false;
      if (directionFilter === 'OUT' && t.direction !== 'OUT') return false;
      // Batch filter
      if (selectedBatchId !== 'ALL' && t.batchId !== selectedBatchId) return false;
      // Search query
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const matchVoucher = t.voucherNo.toLowerCase().includes(q);
        const matchParty = t.partyName.toLowerCase().includes(q);
        const matchType = t.transactionLabel.toLowerCase().includes(q);
        const matchBarcode = t.barcode?.toLowerCase().includes(q);
        if (!matchVoucher && !matchParty && !matchType && !matchBarcode) {
          return false;
        }
      }
      return true;
    });
  }, [ledgerData, selectedMonth, directionFilter, selectedBatchId, searchFilter]);

  // Export to CSV
  const handleExportCSV = () => {
    if (!ledgerData) return;

    if (activeView === 'monthly') {
      const headers = [
        'Month',
        'Opening Qty',
        'Inwards Qty',
        'Inwards Value',
        'Outwards Qty',
        'Outwards Value',
        'Closing Qty',
        'Transactions',
      ];
      const rows = ledgerData.monthlySummaries.map(m => [
        `"${m.monthLabel}"`,
        m.openingQty,
        m.purchaseQty + m.returnIn + m.openingStockEntry,
        m.purchaseValue,
        m.salesQty + m.returnOut,
        m.salesValue,
        m.closingQty,
        m.transactionCount,
      ]);
      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      downloadFile(csvContent, `${ledgerData.item.code}_monthly_ledger.csv`, 'text/csv');
    } else {
      const headers = [
        'Date',
        'Voucher Type',
        'Voucher No',
        'Party Name',
        'In Qty',
        'Out Qty',
        'Rate',
        'Total Value',
        'Running Balance',
        'Power / Barcode',
      ];
      const rows = filteredTransactions.map(t => [
        `"${new Date(t.date).toLocaleDateString()}"`,
        `"${t.transactionLabel}"`,
        `"${t.voucherNo}"`,
        `"${t.partyName}"`,
        t.quantityIn,
        t.quantityOut,
        t.rate,
        t.value,
        t.runningBalance,
        `"${t.barcode || ''} SPH:${t.sph ?? ''} CYL:${t.cyl ?? ''}"`,
      ]);
      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      downloadFile(csvContent, `${ledgerData.item.code}_transactions_ledger.csv`, 'text/csv');
    }
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!itemId) return null;

  return (
    <div
      id="modal-stock-item-ledger"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-3 md:p-6 overflow-hidden"
    >
      <div className="bg-white rounded-2xl w-full max-w-6xl h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Top Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600/30 border border-indigo-400/30 rounded-xl text-indigo-300">
              <Boxes className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                  {ledgerData?.item.code || 'ITEM'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                  {ledgerData?.item.categoryCode || 'Optical'}
                </span>
                <span className="text-xs text-slate-400">
                  {ledgerData?.item.primaryItemName ? `• ${ledgerData.item.primaryItemName}` : ''}
                </span>
              </div>
              <h2 className="text-lg md:text-xl font-bold text-white tracking-tight mt-0.5">
                {ledgerData?.item.name || itemName || 'Stock Item Ledger'}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchLedger}
              disabled={loading}
              className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Refresh ledger"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleExportCSV}
              disabled={loading || !ledgerData}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors cursor-pointer"
              title="Export ledger as CSV"
            >
              <Download className="h-3.5 w-3.5 text-indigo-400" />
              <span>Export</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer ml-1"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Stock Summary Strip */}
        {ledgerData && (
          <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 shrink-0">
            <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <span className="text-[11px] font-medium text-slate-500 block">Physical Stock</span>
              <span className="text-base font-bold text-slate-900 font-mono">
                {ledgerData.stockSummary.physicalStock}{' '}
                <span className="text-xs font-normal text-slate-500">pcs</span>
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <span className="text-[11px] font-medium text-amber-600 block">Reserved Stock</span>
              <span className="text-base font-bold text-amber-700 font-mono">
                {ledgerData.stockSummary.reservedStock}{' '}
                <span className="text-xs font-normal text-amber-600">pcs</span>
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <span className="text-[11px] font-medium text-emerald-600 block">Available to Sell</span>
              <span className="text-base font-bold text-emerald-700 font-mono">
                {ledgerData.stockSummary.availableStock}{' '}
                <span className="text-xs font-normal text-emerald-600">pcs</span>
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <span className="text-[11px] font-medium text-blue-600 block">Total Purchases</span>
              <span className="text-base font-bold text-blue-700 font-mono">
                {ledgerData.stockSummary.totalPurchasedQty}{' '}
                <span className="text-xs font-normal text-blue-600">
                  (₹{ledgerData.stockSummary.totalPurchasedValue.toLocaleString()})
                </span>
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <span className="text-[11px] font-medium text-indigo-600 block">Total Sales</span>
              <span className="text-base font-bold text-indigo-700 font-mono">
                {ledgerData.stockSummary.totalSoldQty}{' '}
                <span className="text-xs font-normal text-indigo-600">
                  (₹{ledgerData.stockSummary.totalSoldValue.toLocaleString()})
                </span>
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <span className="text-[11px] font-medium text-slate-500 block">Purchase Rate / MRP</span>
              <span className="text-xs font-bold text-slate-800 font-mono">
                ₹{Number(ledgerData.item.purchaseRate).toFixed(2)} / ₹{Number(ledgerData.item.mrp).toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* View Switcher Tabs & Filter Bar */}
        <div className="px-6 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveView('monthly')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeView === 'monthly'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>Month-wise Summary</span>
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-700/40 text-[10px]">
                {ledgerData?.monthlySummaries.length || 0}
              </span>
            </button>
            <button
              onClick={() => setActiveView('transactions')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeView === 'transactions'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Voucher Drill-down</span>
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-700/40 text-[10px]">
                {filteredTransactions.length}
              </span>
            </button>
          </div>

          {/* Sub-filters for transactions view */}
          {activeView === 'transactions' && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Month selector filter */}
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              >
                <option value="ALL">All Months</option>
                {ledgerData?.monthlySummaries.map(m => (
                  <option key={m.month} value={m.month}>
                    {m.monthLabel}
                  </option>
                ))}
              </select>

              {/* Movement direction filter */}
              <select
                value={directionFilter}
                onChange={e => setDirectionFilter(e.target.value as any)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              >
                <option value="ALL">In & Out (All)</option>
                <option value="IN">Inwards Only</option>
                <option value="OUT">Outwards Only</option>
              </select>

              {/* Power Batch filter if multiple batches */}
              {distinctBatches.length > 1 && (
                <select
                  value={selectedBatchId}
                  onChange={e => setSelectedBatchId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="ALL">All Power Batches</option>
                  {distinctBatches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.barcode} (SPH: {b.sph > 0 ? `+${b.sph}` : b.sph} CYL: {b.cyl})
                    </option>
                  ))}
                </select>
              )}

              {/* Search text box */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter voucher / party..."
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 w-48"
                />
              </div>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-100/50">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <RefreshCw className="h-8 w-8 text-indigo-600 animate-spin" />
              <p className="text-sm font-medium text-slate-600">Reconciling stock item ledger...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-center gap-3">
              <Info className="h-5 w-5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : activeView === 'monthly' ? (
            /* ========================================================================= */
            /* VIEW 1: TALLY MONTH-WISE PURCHASES & SALES SUMMARY                         */
            /* ========================================================================= */
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-indigo-600" />
                      Month-wise Stock Flow Register
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Tally-style monthly breakdown of Opening Balance, Inwards, Outwards, and Closing Balance.
                      Click any month row to drill down into its individual transaction vouchers.
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100/80 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px] tracking-wider">
                        <th className="py-3 px-4">Month</th>
                        <th className="py-3 px-3 text-right font-mono">Opening Qty</th>
                        <th className="py-3 px-3 text-right font-mono text-blue-700">Inward Qty</th>
                        <th className="py-3 px-3 text-right font-mono text-blue-700">Inward Val (₹)</th>
                        <th className="py-3 px-3 text-right font-mono text-indigo-700">Outward Qty</th>
                        <th className="py-3 px-3 text-right font-mono text-indigo-700">Outward Val (₹)</th>
                        <th className="py-3 px-3 text-right font-mono text-slate-700">Net Flow</th>
                        <th className="py-3 px-4 text-right font-mono font-bold text-slate-900 bg-slate-50">
                          Closing Qty
                        </th>
                        <th className="py-3 px-4 text-center">Drill-down</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {ledgerData?.monthlySummaries.map((m) => {
                        const totalInwardQty = m.purchaseQty + m.returnIn + m.openingStockEntry;
                        const totalOutwardQty = m.salesQty + m.returnOut;
                        const netFlow = totalInwardQty - totalOutwardQty + m.adjustment;

                        return (
                          <tr
                            key={m.month}
                            onClick={() => {
                              setSelectedMonth(m.month);
                              setActiveView('transactions');
                            }}
                            className="hover:bg-indigo-50/50 transition-colors cursor-pointer group"
                          >
                            <td className="py-3 px-4 font-semibold text-slate-900 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-indigo-500 group-hover:scale-125 transition-transform" />
                              {m.monthLabel}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-slate-600">
                              {m.openingQty}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-blue-700 font-semibold bg-blue-50/30">
                              +{totalInwardQty}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-blue-700">
                              ₹{m.purchaseValue.toLocaleString()}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-indigo-700 font-semibold bg-indigo-50/30">
                              -{totalOutwardQty}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-indigo-700">
                              ₹{m.salesValue.toLocaleString()}
                            </td>
                            <td className="py-3 px-3 text-right font-mono">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                                  netFlow > 0
                                    ? 'text-emerald-700 bg-emerald-50'
                                    : netFlow < 0
                                    ? 'text-rose-700 bg-rose-50'
                                    : 'text-slate-600 bg-slate-100'
                                }`}
                              >
                                {netFlow > 0 ? `+${netFlow}` : netFlow}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 bg-slate-50 text-sm">
                              {m.closingQty}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 group-hover:text-indigo-800"
                              >
                                <span>{m.transactionCount} vouchers</span>
                                <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      {ledgerData && (
                        <tr className="bg-slate-100 text-slate-900 font-bold border-t-2 border-slate-300">
                          <td className="py-3.5 px-4 uppercase text-[11px] tracking-wider">Total / Position</td>
                          <td className="py-3.5 px-3 text-right font-mono">
                            {ledgerData.stockSummary.openingBalance}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono text-blue-700">
                            +{ledgerData.stockSummary.totalPurchasedQty}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono text-blue-700">
                            ₹{ledgerData.stockSummary.totalPurchasedValue.toLocaleString()}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono text-indigo-700">
                            -{ledgerData.stockSummary.totalSoldQty}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono text-indigo-700">
                            ₹{ledgerData.stockSummary.totalSoldValue.toLocaleString()}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono">
                            {ledgerData.stockSummary.totalPurchasedQty - ledgerData.stockSummary.totalSoldQty}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono text-sm text-slate-900 bg-slate-200/60">
                            {ledgerData.stockSummary.closingBalance}
                          </td>
                          <td className="py-3.5 px-4 text-center text-slate-500 font-normal">
                            {ledgerData.transactions.length} total
                          </td>
                        </tr>
                      )}
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* ========================================================================= */
            /* VIEW 2: TALLY VOUCHER / TRANSACTION LEVEL DRILL-DOWN                       */
            /* ========================================================================= */
            <div className="space-y-4">
              {/* Active Filter Notice */}
              {selectedMonth !== 'ALL' && (
                <div className="flex items-center justify-between px-4 py-2.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-indigo-600" />
                    <span>
                      Drilling down into month:{' '}
                      <strong className="font-semibold">
                        {ledgerData?.monthlySummaries.find(m => m.month === selectedMonth)?.monthLabel || selectedMonth}
                      </strong>
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedMonth('ALL')}
                    className="font-semibold text-indigo-700 hover:text-indigo-900 hover:underline cursor-pointer"
                  >
                    View All Months
                  </button>
                </div>
              )}

              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100/80 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px] tracking-wider">
                        <th className="py-3 px-3">Date</th>
                        <th className="py-3 px-3">Voucher Type</th>
                        <th className="py-3 px-3">Voucher No</th>
                        <th className="py-3 px-4">Particulars / Party Name</th>
                        <th className="py-3 px-3 font-mono">Batch / Optical Power</th>
                        <th className="py-3 px-3 text-right font-mono text-blue-700">Inward Qty</th>
                        <th className="py-3 px-3 text-right font-mono text-indigo-700">Outward Qty</th>
                        <th className="py-3 px-3 text-right font-mono">Rate (₹)</th>
                        <th className="py-3 px-3 text-right font-mono">Value (₹)</th>
                        <th className="py-3 px-4 text-right font-mono font-bold text-slate-900 bg-slate-50">
                          Balance Qty
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredTransactions.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="text-center py-12 text-slate-400">
                            <Layers className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                            <p className="text-sm font-medium text-slate-500">
                              No inventory transactions match the selected criteria.
                            </p>
                          </td>
                        </tr>
                      ) : (
                        filteredTransactions.map((tx) => {
                          const isIn = tx.direction === 'IN';
                          const isOut = tx.direction === 'OUT';

                          return (
                            <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                              <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap font-mono text-[11px]">
                                {new Date(tx.date).toLocaleDateString('en-GB', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                                    isIn
                                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                      : isOut
                                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                                  }`}
                                >
                                  {isIn ? (
                                    <ArrowDownLeft className="h-3 w-3" />
                                  ) : isOut ? (
                                    <ArrowUpRight className="h-3 w-3" />
                                  ) : (
                                    <Clock className="h-3 w-3" />
                                  )}
                                  {tx.transactionLabel}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-mono font-semibold text-slate-800 whitespace-nowrap">
                                {tx.voucherNo}
                              </td>
                              <td className="py-2.5 px-4 font-medium text-slate-900 max-w-[200px] truncate" title={tx.partyName}>
                                {tx.partyName}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                                {tx.barcode ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                                    <Barcode className="h-3 w-3 text-slate-500" />
                                    <span>{tx.barcode}</span>
                                    {tx.sph !== null && (
                                      <span className="text-slate-500 font-normal">
                                        (SPH {tx.sph > 0 ? `+${tx.sph}` : tx.sph} CYL {tx.cyl})
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-blue-700 font-semibold bg-blue-50/20">
                                {tx.quantityIn > 0 ? `+${tx.quantityIn}` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-indigo-700 font-semibold bg-indigo-50/20">
                                {tx.quantityOut > 0 ? `-${tx.quantityOut}` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                                {tx.rate > 0 ? `₹${Number(tx.rate).toFixed(2)}` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-slate-900 font-medium">
                                {tx.value > 0 ? `₹${Number(tx.value).toFixed(2)}` : '—'}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900 bg-slate-50 text-xs">
                                {tx.runningBalance}
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
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>All entries reconciled against canonical stock movement records and verified against physical lots.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
