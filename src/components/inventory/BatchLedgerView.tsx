import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  ArrowLeft, Calendar, FileText, Search, RefreshCw, Barcode, Copy, Check,
  ArrowDownLeft, ArrowUpRight, Clock, ExternalLink, Filter, Download,
  Layers, AlertTriangle, ChevronRight, ChevronDown, CheckCircle2, Printer
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { VoucherDetailModal } from '../voucher/VoucherDetailModal.js';
import { formatQuantity, formatCurrency } from '../../utils/numberFormatting.js';
import { QuickPeriodKey, getDateRangeForPeriod } from '../../utils/datePeriods.js';

interface BatchLedgerViewProps {
  batchId: string;
  onBackToBatches: () => void;
  onBackToItems: () => void;
  onNavigate?: (path: string) => void;
}

export const BatchLedgerView: React.FC<BatchLedgerViewProps> = ({
  batchId,
  onBackToBatches,
  onBackToItems,
  onNavigate,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [batchData, setBatchData] = useState<any | null>(null);
  const [stockItemData, setStockItemData] = useState<any | null>(null);
  const [stockSummary, setStockSummary] = useState<any | null>(null);
  const [monthlySummaries, setMonthlySummaries] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);

  // Date Filtering & Quick Periods
  const [quickPeriod, setQuickPeriod] = useState<QuickPeriodKey>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  // View state: 'MONTH_SUMMARY' or 'TRANSACTIONS'
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedMonthLabel, setSelectedMonthLabel] = useState<string>('');
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});

  // Transaction Filters
  const [txSearch, setTxSearch] = useState('');
  const [txTypeFilter, setTxTypeFilter] = useState('ALL');
  const [copiedBarcode, setCopiedBarcode] = useState(false);

  // Clicked voucher modal
  const [selectedVoucher, setSelectedVoucher] = useState<{
    voucherId: string | null;
    voucherNo: string;
    transactionType: string;
    referenceType?: string | null;
  } | null>(null);

  const fetchLedger = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (fromDate) params.append('from', fromDate);
      if (toDate) params.append('to', toDate);

      const queryStr = params.toString() ? `?${params.toString()}` : '';
      const res = await apiRequest<{
        success: boolean;
        batch: any;
        stockItem: any;
        stockSummary: any;
        monthlySummaries: any[];
        transactions: any[];
      }>(`/api/batches/${batchId}/ledger${queryStr}`);

      setBatchData(res.batch);
      setStockItemData(res.stockItem);
      setStockSummary(res.stockSummary);
      setMonthlySummaries(res.monthlySummaries || []);
      setTransactions(res.transactions || []);
    } catch (err: any) {
      console.error('[FetchBatchLedger Error]', err);
      setError(err.message || 'Failed to fetch batch ledger data');
    } finally {
      setLoading(false);
    }
  }, [batchId, fromDate, toDate]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  const handleSelectQuickPeriod = (period: QuickPeriodKey) => {
    setQuickPeriod(period);
    if (period === 'ALL') {
      setFromDate('');
      setToDate('');
    } else if (period !== 'CUSTOM') {
      const range = getDateRangeForPeriod(period);
      setFromDate(range.from || '');
      setToDate(range.to || '');
    }
  };

  const toggleMonthExpand = (mKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedMonths(prev => ({
      ...prev,
      [mKey]: !prev[mKey],
    }));
  };

  const handleCopyBarcode = () => {
    if (!batchData?.barcode) return;
    navigator.clipboard.writeText(batchData.barcode);
    setCopiedBarcode(true);
    setTimeout(() => setCopiedBarcode(false), 2000);
  };

  // Filter transactions for active view
  const activeTransactions = useMemo(() => {
    let list = transactions;

    // Month filter
    if (selectedMonth) {
      list = list.filter(t => {
        const d = new Date(t.date);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}` === selectedMonth;
      });
    }

    // Type filter
    if (txTypeFilter !== 'ALL') {
      if (txTypeFilter === 'PURCHASE') {
        list = list.filter(t => t.transactionType === 'PURCHASE' || t.transactionType === 'OPENING_STOCK');
      } else if (txTypeFilter === 'SALE') {
        list = list.filter(t => t.transactionType === 'SALE');
      } else if (txTypeFilter === 'RETURN') {
        list = list.filter(t => t.transactionType === 'SALES_RETURN' || t.transactionType === 'PURCHASE_RETURN');
      } else if (txTypeFilter === 'RESERVATION') {
        list = list.filter(t => t.transactionType.includes('RESERV'));
      } else if (txTypeFilter === 'ADJUSTMENT') {
        list = list.filter(t => t.transactionType === 'STOCK_ADJUSTMENT');
      }
    }

    // Text search
    if (txSearch.trim()) {
      const q = txSearch.toLowerCase();
      list = list.filter(t => 
        (t.voucherNo && t.voucherNo.toLowerCase().includes(q)) ||
        (t.partyName && t.partyName.toLowerCase().includes(q)) ||
        (t.notes && t.notes.toLowerCase().includes(q))
      );
    }

    return list;
  }, [transactions, selectedMonth, txTypeFilter, txSearch]);

  const handleExportCSV = () => {
    const headers = ['Date', 'Voucher Type', 'Voucher No', 'Party', 'In Qty', 'Out Qty', 'Rate', 'Value', 'Running Stock', 'Notes'];
    const rows = (activeTransactions || []).map(t => [
      new Date(t.date).toLocaleDateString(),
      t.transactionLabel || t.transactionType,
      t.voucherNo,
      t.partyName || '—',
      t.quantityIn || 0,
      t.quantityOut || 0,
      t.rate || 0,
      t.value || 0,
      t.runningBalance,
      t.notes || '',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Batch_Ledger_${batchData?.barcode || batchId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4 print:space-y-2">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center justify-between print:hidden">
        <nav className="flex items-center gap-1.5 text-xs text-slate-500">
          <button
            onClick={onBackToItems}
            className="hover:text-blue-600 font-medium transition-colors"
          >
            Stock Items
          </button>
          <span>/</span>
          <button
            onClick={onBackToBatches}
            className="hover:text-blue-600 font-medium transition-colors"
          >
            {stockItemData?.name || 'Stock Item'}
          </button>
          <span>/</span>
          <button
            onClick={() => {
              setSelectedMonth(null);
              setSelectedMonthLabel('');
            }}
            className={`font-semibold transition-colors ${selectedMonth ? 'hover:text-blue-600 text-slate-700' : 'text-blue-600'}`}
          >
            {batchData?.formattedName || 'Batch Ledger'}
          </button>
          {selectedMonth && (
            <>
              <span>/</span>
              <span className="text-blue-600 font-semibold">{selectedMonthLabel || selectedMonth}</span>
            </>
          )}
        </nav>

        <button
          onClick={selectedMonth ? () => setSelectedMonth(null) : onBackToBatches}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{selectedMonth ? 'Back to Month Summary' : 'Back to Batches'}</span>
        </button>
      </div>

      {/* Batch Header Info Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-mono font-bold text-slate-900">
                {batchData?.formattedName || 'Optical Batch'}
              </h1>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 font-mono text-xs text-slate-700">
                <Barcode className="h-3.5 w-3.5 text-slate-500" />
                <span>{batchData?.barcode}</span>
                <button
                  onClick={handleCopyBarcode}
                  className="text-slate-400 hover:text-slate-700 p-0.5"
                  title="Copy Barcode"
                >
                  {copiedBarcode ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                {stockItemData?.name} ({stockItemData?.code})
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Combined Sales, Purchase, and Reservation movement audit trail for this exact optical power.
            </p>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors shadow-sm cursor-pointer"
              title="Print ledger report"
            >
              <Printer className="h-4 w-4 text-slate-500" />
              <span>Print</span>
            </button>

            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors shadow-sm cursor-pointer"
              title="Export ledger as CSV"
            >
              <Download className="h-4 w-4 text-slate-500" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={fetchLedger}
              disabled={loading}
              className="p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              title="Refresh ledger"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Aggregated Stock & Commercial Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 mt-4 pt-4 border-t border-slate-100">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Stock</span>
            <span className={`text-lg font-mono font-bold ${
              (batchData?.stock ?? 0) < 0 ? 'text-rose-600' : 'text-slate-900'
            }`}>
              {formatQuantity(batchData?.stock)} {stockItemData?.unit || 'PRS'}
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Reserved</span>
            <span className="text-lg font-mono font-bold text-amber-700">
              {formatQuantity(batchData?.reserved)} {stockItemData?.unit || 'PRS'}
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Available</span>
            <span className={`text-lg font-mono font-bold ${
              (batchData?.available ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-700'
            }`}>
              {formatQuantity(batchData?.available)} {stockItemData?.unit || 'PRS'}
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Purchases</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-sm font-mono font-bold text-blue-800">{formatQuantity(stockSummary?.totalPurchasedQty)}</span>
              <span className="text-[11px] font-mono text-slate-500">
                (₹{Number(stockSummary?.totalPurchasedValue || 0).toFixed(0)})
              </span>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 col-span-2 sm:col-span-1">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Sales</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-sm font-mono font-bold text-emerald-800">{formatQuantity(stockSummary?.totalSoldQty)}</span>
              <span className="text-[11px] font-mono text-slate-500">
                (₹{Number(stockSummary?.totalSoldValue || 0).toFixed(0)})
              </span>
            </div>
          </div>
        </div>

        {/* Date Filter & Quick Periods Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-slate-100 print:hidden">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-slate-500 mr-1 flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              <span>Period:</span>
            </span>
            <button
              type="button"
              onClick={() => handleSelectQuickPeriod('THIS_MONTH')}
              className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-colors cursor-pointer ${
                quickPeriod === 'THIS_MONTH'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => handleSelectQuickPeriod('LAST_MONTH')}
              className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-colors cursor-pointer ${
                quickPeriod === 'LAST_MONTH'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Last Month
            </button>
            <button
              type="button"
              onClick={() => handleSelectQuickPeriod('THIS_FY')}
              className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-colors cursor-pointer ${
                quickPeriod === 'THIS_FY'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              This Financial Year
            </button>
            <button
              type="button"
              onClick={() => handleSelectQuickPeriod('ALL')}
              className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-colors cursor-pointer ${
                quickPeriod === 'ALL' && !fromDate && !toDate
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Time
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 font-medium">From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={e => {
                  setFromDate(e.target.value);
                  setQuickPeriod('CUSTOM');
                }}
                className="px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 font-medium">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={e => {
                  setToDate(e.target.value);
                  setQuickPeriod('CUSTOM');
                }}
                className="px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            {(fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setQuickPeriod('ALL');
                }}
                className="text-xs text-rose-600 hover:text-rose-800 font-medium px-1 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Ledger Content: Month-wise Summary OR Transactions */}
      {!selectedMonth ? (
        /* ---------------- LEVEL 3: MONTH-WISE SUMMARY TABLE (DEFAULT) ---------------- */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Month-wise Stock Summary
              </h2>
            </div>
            <button
              onClick={() => {
                setSelectedMonth('ALL');
                setSelectedMonthLabel('All Period Transactions');
              }}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
            >
              <span>View All Transactions ({transactions.length})</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 uppercase font-semibold text-[11px] tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Month</th>
                    <th className="py-3 px-3 text-right">Opening Stock</th>
                    <th className="py-3 px-3 text-right">Purchase Qty</th>
                    <th className="py-3 px-3 text-right">Purchase Return</th>
                    <th className="py-3 px-3 text-right">Sales Qty</th>
                    <th className="py-3 px-3 text-right">Sales Return</th>
                    <th className="py-3 px-3 text-right">Adjustment</th>
                    <th className="py-3 px-3 text-right">Closing Stock</th>
                    <th className="py-3 px-3 text-right">Purchase Value (₹)</th>
                    <th className="py-3 px-4 text-right">Sales Value (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {loading && monthlySummaries.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-16 text-center text-slate-500">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700 mb-2"></div>
                        <p className="text-xs font-medium">Reconstructing continuous monthly ledger...</p>
                      </td>
                    </tr>
                  ) : error ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-rose-600">
                        <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-rose-500" />
                        <p className="font-semibold text-xs">{error}</p>
                      </td>
                    </tr>
                  ) : monthlySummaries.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-16 text-center text-slate-400">
                        <p className="font-semibold text-slate-600">No transactions found for this Batch.</p>
                        <p className="text-xs text-slate-400 mt-1">
                          Current Stock balance is {batchData?.stock ?? 0} {stockItemData?.unit || 'PRS'}.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    (monthlySummaries || []).map((m: any) => {
                      const closing = Number(m.closingQty ?? 0);
                      const opening = Number(m.openingQty ?? 0);
                      const isExpanded = !!expandedMonths[m.month];
                      const monthTransactions = (transactions || []).filter(t => {
                        const d = new Date(t.date);
                        const y = d.getFullYear();
                        const mo = String(d.getMonth() + 1).padStart(2, '0');
                        return `${y}-${mo}` === m.month;
                      });

                      return (
                        <React.Fragment key={m.month}>
                          <tr
                            onClick={() => {
                              setSelectedMonth(m.month);
                              setSelectedMonthLabel(m.monthLabel);
                            }}
                            className="hover:bg-blue-50/50 transition-colors cursor-pointer group"
                          >
                            {/* Month with Expand Toggle */}
                            <td className="py-3 px-4">
                              <div className="font-semibold text-slate-900 group-hover:text-blue-700 flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => toggleMonthExpand(m.month, e)}
                                  className="p-1 -ml-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-200/60 transition-colors"
                                  title={isExpanded ? 'Collapse month transactions' : 'Expand month transactions'}
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 text-blue-600" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                </button>
                                <span>{m.monthLabel}</span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  ({m.transactionCount} vouchers)
                                </span>
                              </div>
                            </td>

                            {/* Opening Stock */}
                            <td className="py-3 px-3 text-right font-mono font-medium text-slate-600">
                              {formatQuantity(opening)}
                            </td>

                            {/* Purchase Qty */}
                            <td className="py-3 px-3 text-right font-mono font-semibold text-blue-700">
                              {m.purchaseQty > 0 ? `+${formatQuantity(m.purchaseQty)}` : '—'}
                            </td>

                            {/* Purchase Return */}
                            <td className="py-3 px-3 text-right font-mono font-semibold text-indigo-700">
                              {m.returnOut > 0 ? `-${formatQuantity(m.returnOut)}` : '—'}
                            </td>

                            {/* Sales Qty */}
                            <td className="py-3 px-3 text-right font-mono font-semibold text-rose-700">
                              {m.salesQty > 0 ? `-${formatQuantity(m.salesQty)}` : '—'}
                            </td>

                            {/* Sales Return */}
                            <td className="py-3 px-3 text-right font-mono font-semibold text-emerald-700">
                              {m.returnIn > 0 ? `+${formatQuantity(m.returnIn)}` : '—'}
                            </td>

                            {/* Adjustment */}
                            <td className="py-3 px-3 text-right font-mono text-slate-600">
                              {m.adjustment !== 0 ? (m.adjustment > 0 ? `+${formatQuantity(m.adjustment)}` : formatQuantity(m.adjustment)) : '—'}
                            </td>

                            {/* Closing Stock */}
                            <td className={`py-3 px-3 text-right font-mono font-bold ${
                              closing < 0 ? 'text-rose-600 bg-rose-50/30' : 'text-slate-900 bg-slate-50/50'
                            }`}>
                              {formatQuantity(closing)}
                            </td>

                            {/* Purchase Value */}
                            <td className="py-3 px-3 text-right font-mono text-slate-700">
                              {m.purchaseValue > 0 ? `₹${formatCurrency(m.purchaseValue)}` : '—'}
                            </td>

                            {/* Sales Value */}
                            <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-800">
                              {m.salesValue > 0 ? `₹${formatCurrency(m.salesValue)}` : '—'}
                            </td>
                          </tr>

                          {/* Inline Expanded Vouchers for this Month */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={10} className="p-0 bg-slate-50/90 border-y border-blue-100">
                                <div className="p-3.5 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                      <FileText className="h-3.5 w-3.5 text-blue-600" />
                                      <span>Vouchers in {m.monthLabel} ({monthTransactions.length})</span>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedMonth(m.month);
                                        setSelectedMonthLabel(m.monthLabel);
                                      }}
                                      className="text-xs font-semibold text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                                    >
                                      <span>Open Month Detail View</span>
                                      <ChevronRight className="h-3 w-3" />
                                    </button>
                                  </div>

                                  {monthTransactions.length === 0 ? (
                                    <p className="text-xs text-slate-400 py-2">No individual vouchers recorded for this month.</p>
                                  ) : (
                                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                      <table className="w-full text-left text-xs">
                                        <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-600 text-[10px] uppercase font-semibold">
                                          <tr>
                                            <th className="py-2 px-3">Date</th>
                                            <th className="py-2 px-2.5">Type</th>
                                            <th className="py-2 px-2.5">Voucher No.</th>
                                            <th className="py-2 px-3">Party</th>
                                            <th className="py-2 px-2.5 text-right">In</th>
                                            <th className="py-2 px-2.5 text-right">Out</th>
                                            <th className="py-2 px-2.5 text-right">Balance</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 text-[11px]">
                                          {monthTransactions.map(tx => (
                                            <tr key={tx.id} className="hover:bg-blue-50/30">
                                              <td className="py-1.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                                                {new Date(tx.date).toLocaleDateString()}
                                              </td>
                                              <td className="py-1.5 px-2.5 whitespace-nowrap">
                                                <span className="text-[10px] font-medium text-slate-700">
                                                  {tx.transactionLabel || tx.transactionType}
                                                </span>
                                              </td>
                                              <td className="py-1.5 px-2.5 whitespace-nowrap font-mono font-bold text-blue-700">
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedVoucher({
                                                      voucherId: tx.voucherId,
                                                      voucherNo: tx.voucherNo,
                                                      transactionType: tx.transactionType,
                                                      referenceType: tx.referenceType,
                                                    });
                                                  }}
                                                  className="hover:underline inline-flex items-center gap-1"
                                                >
                                                  <span>{tx.voucherNo}</span>
                                                  <ExternalLink className="h-2.5 w-2.5" />
                                                </button>
                                              </td>
                                              <td className="py-1.5 px-3 truncate max-w-[160px] text-slate-800">
                                                {tx.partyName || '—'}
                                              </td>
                                              <td className="py-1.5 px-2.5 text-right font-mono font-bold text-blue-700">
                                                {tx.quantityIn > 0 ? `+${formatQuantity(tx.quantityIn)}` : '—'}
                                              </td>
                                              <td className="py-1.5 px-2.5 text-right font-mono font-bold text-rose-700">
                                                {tx.quantityOut > 0 ? `-${formatQuantity(tx.quantityOut)}` : '—'}
                                              </td>
                                              <td className={`py-1.5 px-2.5 text-right font-mono font-bold ${
                                                Number(tx.runningBalance) < 0 ? 'text-rose-600' : 'text-slate-900'
                                              }`}>
                                                {formatQuantity(tx.runningBalance)}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* ---------------- LEVEL 4: INDIVIDUAL TRANSACTION LEDGER TABLE ---------------- */
        <div className="space-y-3">
          {/* Controls Bar */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-900">
                {selectedMonthLabel || selectedMonth}
              </span>
              <span className="text-xs text-slate-500">
                ({activeTransactions.length} movement records)
              </span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={txSearch}
                  onChange={e => setTxSearch(e.target.value)}
                  placeholder="Filter voucher / party..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <select
                value={txTypeFilter}
                onChange={e => setTxTypeFilter(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none"
              >
                <option value="ALL">All Types</option>
                <option value="PURCHASE">Purchases</option>
                <option value="SALE">Sales</option>
                <option value="RETURN">Returns</option>
                <option value="RESERVATION">Reservations</option>
                <option value="ADJUSTMENT">Adjustments</option>
              </select>

              <button
                onClick={() => {
                  setSelectedMonth(null);
                  setSelectedMonthLabel('');
                }}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                View by Month
              </button>
            </div>
          </div>

          {/* Unified Transactions Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 uppercase font-semibold text-[11px] tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-3">Voucher Type</th>
                    <th className="py-3 px-3">Voucher No.</th>
                    <th className="py-3 px-4">Party</th>
                    <th className="py-3 px-3 text-right">In Qty</th>
                    <th className="py-3 px-3 text-right">Out Qty</th>
                    <th className="py-3 px-3 text-right">Rate</th>
                    <th className="py-3 px-3 text-right">Allocated Value</th>
                    <th className="py-3 px-3 text-right">Running Stock</th>
                    <th className="py-3 px-3 text-right">Reserved</th>
                    <th className="py-3 px-4">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {activeTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-16 text-center text-slate-400">
                        <FileText className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                        <p className="font-semibold text-slate-600">No transactions match the selected filters</p>
                        <p className="text-xs text-slate-400 mt-1">Try switching to 'All Types' or clearing the search query.</p>
                      </td>
                    </tr>
                  ) : (
                    (activeTransactions || []).map(tx => {
                      const isIn = tx.quantityIn > 0;
                      const isOut = tx.quantityOut > 0;
                      const isReservation = tx.reservedIn > 0 || tx.reservedOut > 0 || tx.transactionType.includes('RESERV');
                      const running = Number(tx.runningBalance);

                      return (
                        <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors">
                          {/* Date */}
                          <td className="py-2.5 px-4 whitespace-nowrap text-slate-600 font-mono text-[11px]">
                            {new Date(tx.date).toLocaleDateString()}
                          </td>

                          {/* Voucher Type */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              tx.transactionType === 'PURCHASE'
                                ? 'bg-blue-50 text-blue-800 border border-blue-200'
                                : tx.transactionType === 'SALE'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : tx.transactionType === 'SALES_RETURN'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : tx.transactionType === 'PURCHASE_RETURN'
                                ? 'bg-rose-50 text-rose-800 border border-rose-200'
                                : isReservation
                                ? 'bg-purple-50 text-purple-800 border border-purple-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}>
                              {isIn ? (
                                <ArrowDownLeft className="h-3 w-3" />
                              ) : isOut ? (
                                <ArrowUpRight className="h-3 w-3" />
                              ) : (
                                <Clock className="h-3 w-3" />
                              )}
                              {tx.transactionLabel || tx.transactionType}
                            </span>
                          </td>

                          {/* Voucher No. (CLICKABLE!) */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <button
                              onClick={() => {
                                setSelectedVoucher({
                                  voucherId: tx.voucherId,
                                  voucherNo: tx.voucherNo,
                                  transactionType: tx.transactionType,
                                  referenceType: tx.referenceType,
                                });
                              }}
                              className="font-mono font-bold text-blue-700 hover:text-blue-900 hover:underline inline-flex items-center gap-1 group"
                              title="Click to view voucher details"
                            >
                              <span>{tx.voucherNo}</span>
                              <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                          </td>

                          {/* Party (Unified Single Party Column) */}
                          <td className="py-2.5 px-4 text-slate-900 font-medium truncate max-w-[180px]" title={tx.partyName}>
                            {tx.partyName || '—'}
                          </td>

                          {/* In Qty */}
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-700 bg-blue-50/20">
                            {isIn ? `+${formatQuantity(tx.quantityIn)}` : '—'}
                          </td>

                          {/* Out Qty */}
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-700 bg-rose-50/20">
                            {isOut ? `-${formatQuantity(tx.quantityOut)}` : '—'}
                          </td>

                          {/* Rate */}
                          <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                            {tx.rate > 0 ? `₹${formatCurrency(tx.rate)}` : '—'}
                          </td>

                          {/* Value */}
                          <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900">
                            {tx.value > 0 ? `₹${formatCurrency(tx.value)}` : '—'}
                          </td>

                          {/* Running Stock */}
                          <td className={`py-2.5 px-3 text-right font-mono font-bold ${
                            running < 0 ? 'text-rose-600 bg-rose-50/40' : 'text-slate-900 bg-slate-50/60'
                          }`}>
                            {formatQuantity(running)}
                          </td>

                          {/* Reserved Delta */}
                          <td className="py-2.5 px-3 text-right font-mono text-amber-700">
                            {tx.reservedIn > 0 ? `+${formatQuantity(tx.reservedIn)}` : tx.reservedOut > 0 ? `-${formatQuantity(tx.reservedOut)}` : '—'}
                          </td>

                          {/* Notes */}
                          <td className="py-2.5 px-4 text-slate-500 truncate max-w-[150px]" title={tx.notes}>
                            {tx.notes || '—'}
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

      {/* Voucher Detail Inspection Modal */}
      {selectedVoucher && (
        <VoucherDetailModal
          isOpen={true}
          onClose={() => setSelectedVoucher(null)}
          voucherId={selectedVoucher.voucherId}
          voucherNo={selectedVoucher.voucherNo}
          transactionType={selectedVoucher.transactionType}
          referenceType={selectedVoucher.referenceType}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
};
