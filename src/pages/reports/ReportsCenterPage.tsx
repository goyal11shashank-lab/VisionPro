import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Boxes,
  Layers,
  Receipt,
  Truck,
  Clock,
  BookOpen,
  CreditCard,
  Download,
  Filter,
  Search,
  Calendar,
  RefreshCw,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  AlertOctagon,
  ArrowDownLeft,
  ArrowUpRight,
  Sparkles,
  Barcode,
  Eye,
  FileSpreadsheet,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { apiRequest, getAuthHeaders } from '../../api/client.js';

type ReportTab =
  | 'inventory'
  | 'stock-ledger'
  | 'sales'
  | 'purchases'
  | 'outstanding'
  | 'party-statement'
  | 'payments'
  | 'analytics';

export const ReportsCenterPage: React.FC<{ initialTab?: ReportTab }> = ({ initialTab = 'inventory' }) => {
  const { currentBusiness } = useAuth();
  const [activeTab, setActiveTab] = useState<ReportTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Common Filter State
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  // Report Specific States
  const [inventoryStatus, setInventoryStatus] = useState<string>('ALL');
  const [sphFilter, setSphFilter] = useState<string>('');
  const [cylFilter, setCylFilter] = useState<string>('');
  const [salesSubTab, setSalesSubTab] = useState<'SUMMARY' | 'DETAILS' | 'RETURNS'>('SUMMARY');
  const [purchaseSubTab, setPurchaseSubTab] = useState<'SUMMARY' | 'DETAILS' | 'RETURNS'>('SUMMARY');
  const [outstandingType, setOutstandingType] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER');
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [paymentType, setPaymentType] = useState<string>('ALL');
  const [paymentMode, setPaymentMode] = useState<string>('ALL');

  // Master Data Lists for select dropdowns
  const [partiesList, setPartiesList] = useState<any[]>([]);

  // Report Data States
  const [reportData, setReportData] = useState<any>(null);

  // Load Parties for party statement selector
  useEffect(() => {
    apiRequest('/api/parties')
      .then(res => setPartiesList(Array.isArray(res) ? res : res.data || []))
      .catch(() => {});
  }, [currentBusiness?.id]);

  // Fetch Report Data on tab or filter change
  const fetchReport = async () => {
    setLoading(true);
    setError(null);
    try {
      let endpoint = '';

      switch (activeTab) {
        case 'inventory': {
          let query = `/api/reports/inventory?stockStatus=${inventoryStatus}&page=${page}&limit=50`;
          if (searchQuery) query += `&search=${encodeURIComponent(searchQuery)}`;
          if (sphFilter) query += `&sph=${sphFilter}`;
          if (cylFilter) query += `&cyl=${cylFilter}`;
          endpoint = query;
          break;
        }
        case 'stock-ledger': {
          let query = `/api/reports/stock-ledger?startDate=${startDate}&endDate=${endDate}&page=${page}&limit=50`;
          if (searchQuery) query += `&barcode=${encodeURIComponent(searchQuery)}`;
          endpoint = query;
          break;
        }
        case 'sales': {
          if (salesSubTab === 'SUMMARY') {
            endpoint = `/api/reports/sales?startDate=${startDate}&endDate=${endDate}&search=${encodeURIComponent(searchQuery)}&page=${page}&limit=50`;
          } else if (salesSubTab === 'DETAILS') {
            endpoint = `/api/reports/sales/details?startDate=${startDate}&endDate=${endDate}&search=${encodeURIComponent(searchQuery)}&page=${page}&limit=50`;
          } else {
            endpoint = `/api/reports/sales/returns?startDate=${startDate}&endDate=${endDate}&page=${page}&limit=50`;
          }
          break;
        }
        case 'purchases': {
          if (purchaseSubTab === 'SUMMARY') {
            endpoint = `/api/reports/purchases?startDate=${startDate}&endDate=${endDate}&search=${encodeURIComponent(searchQuery)}&page=${page}&limit=50`;
          } else if (purchaseSubTab === 'DETAILS') {
            endpoint = `/api/reports/purchases/details?startDate=${startDate}&endDate=${endDate}&search=${encodeURIComponent(searchQuery)}&page=${page}&limit=50`;
          } else {
            endpoint = `/api/reports/purchases/returns?startDate=${startDate}&endDate=${endDate}&page=${page}&limit=50`;
          }
          break;
        }
        case 'outstanding': {
          const typeEndpoint = outstandingType === 'CUSTOMER' ? 'customers' : 'suppliers';
          endpoint = `/api/reports/outstanding/${typeEndpoint}?search=${encodeURIComponent(searchQuery)}&page=${page}&limit=50`;
          break;
        }
        case 'party-statement': {
          if (!selectedPartyId && partiesList.length > 0) {
            setSelectedPartyId(partiesList[0].id);
            return;
          }
          if (selectedPartyId) {
            const selectedParty = partiesList.find(p => p.id === selectedPartyId);
            const pType = selectedParty?.partyType === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER';
            endpoint = `/api/reports/party-statement/${selectedPartyId}?partyType=${pType}&startDate=${startDate}&endDate=${endDate}`;
          }
          break;
        }
        case 'payments': {
          endpoint = `/api/reports/payments?paymentType=${paymentType}&paymentMode=${paymentMode}&startDate=${startDate}&endDate=${endDate}&search=${encodeURIComponent(searchQuery)}&page=${page}&limit=50`;
          break;
        }
        case 'analytics': {
          endpoint = `/api/reports/analytics/product-sales?startDate=${startDate}&endDate=${endDate}`;
          break;
        }
      }

      if (endpoint) {
        const res = await apiRequest(endpoint);
        setReportData(res);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate report');
      setReportData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [
    activeTab,
    salesSubTab,
    purchaseSubTab,
    outstandingType,
    selectedPartyId,
    inventoryStatus,
    paymentType,
    paymentMode,
    page,
    currentBusiness?.id,
  ]);

  // Export to Excel handler
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      let exportUrl = '';
      switch (activeTab) {
        case 'inventory':
          exportUrl = `/api/reports/inventory?export=true&stockStatus=${inventoryStatus}`;
          break;
        case 'stock-ledger':
          exportUrl = `/api/reports/stock-ledger?export=true&startDate=${startDate}&endDate=${endDate}`;
          break;
        case 'sales':
          if (salesSubTab === 'SUMMARY') {
            exportUrl = `/api/reports/sales?export=true&startDate=${startDate}&endDate=${endDate}`;
          } else if (salesSubTab === 'DETAILS') {
            exportUrl = `/api/reports/sales/details?export=true&startDate=${startDate}&endDate=${endDate}`;
          } else {
            exportUrl = `/api/reports/sales/returns?export=true&startDate=${startDate}&endDate=${endDate}`;
          }
          break;
        case 'purchases':
          if (purchaseSubTab === 'SUMMARY') {
            exportUrl = `/api/reports/purchases?export=true&startDate=${startDate}&endDate=${endDate}`;
          } else if (purchaseSubTab === 'DETAILS') {
            exportUrl = `/api/reports/purchases/details?export=true&startDate=${startDate}&endDate=${endDate}`;
          } else {
            exportUrl = `/api/reports/purchases/returns?export=true&startDate=${startDate}&endDate=${endDate}`;
          }
          break;
        case 'outstanding':
          exportUrl =
            outstandingType === 'CUSTOMER'
              ? `/api/reports/outstanding/customers?export=true`
              : `/api/reports/outstanding/suppliers?export=true`;
          break;
        case 'party-statement':
          if (selectedPartyId) {
            const selectedParty = partiesList.find(p => p.id === selectedPartyId);
            const pType = selectedParty?.partyType === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER';
            exportUrl = `/api/reports/party-statement/${selectedPartyId}?export=true&partyType=${pType}&startDate=${startDate}&endDate=${endDate}`;
          }
          break;
        case 'payments':
          exportUrl = `/api/reports/payments?export=true&paymentType=${paymentType}&paymentMode=${paymentMode}&startDate=${startDate}&endDate=${endDate}`;
          break;
        case 'analytics':
          exportUrl = `/api/reports/analytics/product-sales?export=true&startDate=${startDate}&endDate=${endDate}`;
          break;
      }

      if (exportUrl) {
        const response = await fetch(exportUrl, {
          headers: getAuthHeaders(),
        });
        if (!response.ok) throw new Error('Export download failed');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeTab}_report_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err: any) {
      alert(`Export error: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1">
            <BarChart3 className="w-4 h-4" />
            <span>Analytical & Compliance Center</span>
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
            Reports & Operational Registers
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Live PostgreSQL aggregated registers with multi-attribute optical power filters and one-click Excel XLSX export.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchReport}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={handleExportExcel}
            disabled={exporting || loading}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{exporting ? 'Generating XLSX...' : 'Export Excel (.XLSX)'}</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-200">
        {[
          { id: 'inventory', label: 'Inventory Stock', icon: Boxes },
          { id: 'stock-ledger', label: 'Stock Movement Ledger', icon: Layers },
          { id: 'sales', label: 'Sales Register', icon: Receipt },
          { id: 'purchases', label: 'Purchase Register', icon: Truck },
          { id: 'outstanding', label: 'Outstanding Aging', icon: Clock },
          { id: 'party-statement', label: 'Party Statement', icon: BookOpen },
          { id: 'payments', label: 'Payments & Receipts', icon: CreditCard },
          { id: 'analytics', label: 'Product Analytics', icon: TrendingUp },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as ReportTab);
                setPage(1);
              }}
              className={`px-4 py-2.5 rounded-xl font-semibold text-xs transition-all flex items-center gap-2 whitespace-nowrap ${
                isActive
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Dynamic Filter Bar */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date range for date-based reports */}
          {['stock-ledger', 'sales', 'purchases', 'party-statement', 'payments', 'analytics'].includes(activeTab) && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="bg-transparent border-none text-slate-700 focus:outline-hidden text-xs"
                />
              </div>
              <span className="text-slate-400 text-xs font-bold">to</span>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="bg-transparent border-none text-slate-700 focus:outline-hidden text-xs"
                />
              </div>
            </div>
          )}

          {/* Inventory stock filter status */}
          {activeTab === 'inventory' && (
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold text-slate-600">Stock Status:</label>
              <select
                value={inventoryStatus}
                onChange={e => setInventoryStatus(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 focus:outline-hidden"
              >
                <option value="ALL">All Batches</option>
                <option value="IN_STOCK">In Stock (&gt; 0)</option>
                <option value="LOW_STOCK">Low Stock (≤ Threshold)</option>
                <option value="ZERO_STOCK">Zero Stock (= 0)</option>
                <option value="NEGATIVE_STOCK">Negative Stock (&lt; 0)</option>
                <option value="RESERVED">Reserved In Orders</option>
              </select>

              <input
                type="number"
                step="0.25"
                placeholder="SPH"
                value={sphFilter}
                onChange={e => setSphFilter(e.target.value)}
                className="w-20 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-700"
              />
              <input
                type="number"
                step="0.25"
                placeholder="CYL"
                value={cylFilter}
                onChange={e => setCylFilter(e.target.value)}
                className="w-20 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-700"
              />
            </div>
          )}

          {/* Sales sub-tabs */}
          {activeTab === 'sales' && (
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setSalesSubTab('SUMMARY')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  salesSubTab === 'SUMMARY' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Invoices Summary
              </button>
              <button
                onClick={() => setSalesSubTab('DETAILS')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  salesSubTab === 'DETAILS' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Line-Item Drilldown
              </button>
              <button
                onClick={() => setSalesSubTab('RETURNS')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  salesSubTab === 'RETURNS' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Sales Returns (Credit Notes)
              </button>
            </div>
          )}

          {/* Purchase sub-tabs */}
          {activeTab === 'purchases' && (
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setPurchaseSubTab('SUMMARY')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  purchaseSubTab === 'SUMMARY' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Purchase Invoices
              </button>
              <button
                onClick={() => setPurchaseSubTab('DETAILS')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  purchaseSubTab === 'DETAILS' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Line-Item Drilldown
              </button>
              <button
                onClick={() => setPurchaseSubTab('RETURNS')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  purchaseSubTab === 'RETURNS' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Purchase Returns (Debit Notes)
              </button>
            </div>
          )}

          {/* Outstanding party type */}
          {activeTab === 'outstanding' && (
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setOutstandingType('CUSTOMER')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  outstandingType === 'CUSTOMER' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Customer Receivables
              </button>
              <button
                onClick={() => setOutstandingType('SUPPLIER')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  outstandingType === 'SUPPLIER' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Supplier Payables
              </button>
            </div>
          )}

          {/* Party Statement Party Selector */}
          {activeTab === 'party-statement' && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-600">Select Party:</label>
              <select
                value={selectedPartyId}
                onChange={e => setSelectedPartyId(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 min-w-[200px]"
              >
                {partiesList.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.partyType})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Search bar */}
          {activeTab !== 'party-statement' && (
            <div className="flex-1 min-w-[180px] max-w-xs relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchReport()}
                className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-hidden focus:border-blue-500"
              />
            </div>
          )}

          <button
            onClick={fetchReport}
            className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
          >
            Apply Filter
          </button>
        </div>
      </div>

      {/* Summary KPI Cards if provided by report */}
      {reportData?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(reportData.summary).map(([key, val]: any) => {
            if (typeof val === 'object' && val !== null) return null;
            return (
              <div key={key} className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </div>
                <div className="text-lg md:text-xl font-bold text-slate-900 mt-1">
                  {typeof val === 'number' && key.toLowerCase().includes('amount') || key.toLowerCase().includes('total') || key.toLowerCase().includes('balance')
                    ? `₹${Number(val).toLocaleString()}`
                    : String(val)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Report Table Content */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-400 space-y-3">
            <RefreshCw className="w-8 h-8 mx-auto animate-spin text-blue-600" />
            <p className="text-sm font-medium">Aggregating PostgreSQL records...</p>
          </div>
        ) : error ? (
          <div className="py-16 text-center text-rose-500 space-y-2">
            <AlertTriangle className="w-8 h-8 mx-auto" />
            <p className="text-sm font-semibold">{error}</p>
          </div>
        ) : !reportData || (reportData.data && reportData.data.length === 0) || (reportData.rows && reportData.rows.length === 0) || (reportData.parties && reportData.parties.length === 0) ? (
          <div className="py-16 text-center text-slate-400 space-y-2">
            <FileSpreadsheet className="w-8 h-8 mx-auto text-slate-300 stroke-1" />
            <p className="text-sm font-medium text-slate-700">No records found matching criteria</p>
            <p className="text-xs text-slate-400">Try broadening your date range or adjusting status filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* 1. INVENTORY STOCK TABLE */}
            {activeTab === 'inventory' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Barcode</th>
                    <th className="py-3 px-4">Product Name / SKU</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Brand</th>
                    <th className="py-3 px-4 text-center">SPH</th>
                    <th className="py-3 px-4 text-center">CYL</th>
                    <th className="py-3 px-4 text-center">AXIS</th>
                    <th className="py-3 px-4 text-center">ADD</th>
                    <th className="py-3 px-4 text-center">SIDE</th>
                    <th className="py-3 px-4 text-right">Physical Stock</th>
                    <th className="py-3 px-4 text-right">Reserved</th>
                    <th className="py-3 px-4 text-right">Available</th>
                    <th className="py-3 px-4 text-right">MRP</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.data.map((row: any) => (
                    <tr key={row.batch_id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{row.barcode}</td>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-800">{row.unique_item_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">SKU: {row.sku}</div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{row.category_name}</td>
                      <td className="py-2.5 px-4 text-slate-600">{row.brand_name}</td>
                      <td className="py-2.5 px-4 text-center font-mono">{row.sph ?? '-'}</td>
                      <td className="py-2.5 px-4 text-center font-mono">{row.cyl ?? '-'}</td>
                      <td className="py-2.5 px-4 text-center font-mono">{row.axis ?? '-'}</td>
                      <td className="py-2.5 px-4 text-center font-mono">{row.add ?? '-'}</td>
                      <td className="py-2.5 px-4 text-center font-mono">{row.side ?? '-'}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900">{row.physical_stock}</td>
                      <td className="py-2.5 px-4 text-right text-amber-600 font-semibold">{row.reserved_stock}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-emerald-600">{row.available_stock}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-800">₹{Number(row.mrp || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            row.stock_status === 'IN_STOCK'
                              ? 'bg-emerald-100 text-emerald-700'
                              : row.stock_status === 'LOW_STOCK'
                              ? 'bg-amber-100 text-amber-700'
                              : row.stock_status === 'ZERO_STOCK'
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-rose-100 text-rose-700'
                          }`}
                        >
                          {row.stock_status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 2. STOCK LEDGER TABLE */}
            {activeTab === 'stock-ledger' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Barcode</th>
                    <th className="py-3 px-4">Product Name / Power</th>
                    <th className="py-3 px-4">Transaction Type</th>
                    <th className="py-3 px-4">Document No</th>
                    <th className="py-3 px-4 text-right">Qty In</th>
                    <th className="py-3 px-4 text-right">Qty Out</th>
                    <th className="py-3 px-4 text-right">Balance After</th>
                    <th className="py-3 px-4">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.data.map((row: any) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-slate-600">{new Date(row.created_at).toLocaleString()}</td>
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{row.barcode}</td>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-800">{row.unique_item_name}</div>
                        <div className="text-[10px] text-slate-500">
                          SPH: {row.sph} | CYL: {row.cyl} | AXIS: {row.axis}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-semibold text-[10px]">
                          {row.transaction_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-700">{row.document_number}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-emerald-600">
                        {Number(row.quantity_in) > 0 ? `+${row.quantity_in}` : '-'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-rose-600">
                        {Number(row.quantity_out) > 0 ? `-${row.quantity_out}` : '-'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900">{row.balance_after}</td>
                      <td className="py-2.5 px-4 text-slate-500 max-w-xs truncate">{row.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 3. SALES REGISTER TABLE */}
            {activeTab === 'sales' && salesSubTab === 'SUMMARY' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Invoice #</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Customer Name</th>
                    <th className="py-3 px-4 text-right">Gross Subtotal</th>
                    <th className="py-3 px-4 text-right">Discount</th>
                    <th className="py-3 px-4 text-right">Taxable</th>
                    <th className="py-3 px-4 text-right">GST</th>
                    <th className="py-3 px-4 text-right">Grand Total</th>
                    <th className="py-3 px-4 text-right">Paid</th>
                    <th className="py-3 px-4 text-right">Balance</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.data.map((row: any) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-bold text-blue-600">{row.invoice_number}</td>
                      <td className="py-2.5 px-4 text-slate-600">{new Date(row.invoice_date).toLocaleDateString()}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{row.customer_name}</td>
                      <td className="py-2.5 px-4 text-right">₹{Number(row.subtotal).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-slate-500">₹{Number(row.discount_total).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right">₹{Number(row.taxable_amount).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">
                        ₹{(Number(row.igst_amount || 0) + Number(row.cgst_amount || 0) + Number(row.sgst_amount || 0)).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900">₹{Number(row.grand_total).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-emerald-600 font-semibold">₹{Number(row.paid_amount || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-rose-600">₹{Number(row.outstanding_balance || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 4. PURCHASE REGISTER TABLE */}
            {activeTab === 'purchases' && purchaseSubTab === 'SUMMARY' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Bill / Inv #</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Supplier Name</th>
                    <th className="py-3 px-4 text-right">Subtotal</th>
                    <th className="py-3 px-4 text-right">Discount</th>
                    <th className="py-3 px-4 text-right">Taxable</th>
                    <th className="py-3 px-4 text-right">GST</th>
                    <th className="py-3 px-4 text-right">Grand Total</th>
                    <th className="py-3 px-4 text-right">Paid</th>
                    <th className="py-3 px-4 text-right">Balance</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.data.map((row: any) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-bold text-indigo-600">{row.invoice_number}</td>
                      <td className="py-2.5 px-4 text-slate-600">{new Date(row.invoice_date).toLocaleDateString()}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{row.supplier_name}</td>
                      <td className="py-2.5 px-4 text-right">₹{Number(row.subtotal).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-slate-500">₹{Number(row.discount_total).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right">₹{Number(row.taxable_amount).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">
                        ₹{(Number(row.igst_amount || 0) + Number(row.cgst_amount || 0) + Number(row.sgst_amount || 0)).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900">₹{Number(row.grand_total).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-emerald-600 font-semibold">₹{Number(row.paid_amount || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-rose-600">₹{Number(row.outstanding_balance || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 5. OUTSTANDING AGING TABLE */}
            {activeTab === 'outstanding' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Party Name</th>
                    <th className="py-3 px-4">Mobile</th>
                    <th className="py-3 px-4 text-right">Credit Limit</th>
                    <th className="py-3 px-4 text-center">Credit Days</th>
                    <th className="py-3 px-4 text-right">Total Outstanding</th>
                    <th className="py-3 px-4 text-right">Overdue Balance</th>
                    <th className="py-3 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.parties.map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-600">{p.party_code}</td>
                      <td className="py-2.5 px-4 font-bold text-slate-900">{p.name}</td>
                      <td className="py-2.5 px-4 text-slate-600">{p.mobile || '-'}</td>
                      <td className="py-2.5 px-4 text-right text-slate-700">₹{Number(p.credit_limit || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-center font-semibold">{p.credit_days || 0} days</td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900">₹{Number(p.outstanding_balance || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-rose-600">
                        {Number(p.overdue_balance || 0) > 0 ? `₹${Number(p.overdue_balance).toLocaleString()}` : '₹0.00'}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <button
                          onClick={() => {
                            setSelectedPartyId(p.id);
                            setActiveTab('party-statement');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-[10px] transition-colors"
                        >
                          View Statement
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 6. PARTY STATEMENT TABLE */}
            {activeTab === 'party-statement' && reportData.party && (
              <div className="p-4 space-y-4">
                {/* Party Profile Header */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{reportData.party.name}</h3>
                    <p className="text-xs text-slate-500">
                      Code: <span className="font-mono font-semibold">{reportData.party.party_code}</span> | GSTIN: {reportData.party.gstin || 'Unregistered'} | Mobile: {reportData.party.mobile || 'N/A'}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-semibold">
                    <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                      <span className="text-slate-500">Opening Balance: </span>
                      <span className="font-bold text-slate-900">₹{Number(reportData.openingBalance || 0).toLocaleString()}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                      <span className="text-slate-500">Closing Balance: </span>
                      <span className="font-bold text-blue-600">₹{Number(reportData.closingBalance || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Transaction Type</th>
                      <th className="py-3 px-4">Document No</th>
                      <th className="py-3 px-4 text-right">Debit (₹)</th>
                      <th className="py-3 px-4 text-right">Credit (₹)</th>
                      <th className="py-3 px-4 text-right">Running Balance (₹)</th>
                      <th className="py-3 px-4">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportData.rows.map((r: any) => (
                      <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-4 font-mono text-slate-600">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="py-2.5 px-4 font-semibold text-slate-800">{r.transaction_type}</td>
                        <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">{r.document_number}</td>
                        <td className="py-2.5 px-4 text-right font-bold text-rose-600">
                          {Number(r.debit) > 0 ? `₹${Number(r.debit).toLocaleString()}` : '-'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-bold text-emerald-600">
                          {Number(r.credit) > 0 ? `₹${Number(r.credit).toLocaleString()}` : '-'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-bold text-slate-900">₹{Number(r.balance).toLocaleString()}</td>
                        <td className="py-2.5 px-4 text-slate-500 max-w-xs truncate">{r.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 7. PAYMENTS TABLE */}
            {activeTab === 'payments' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Payment #</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Party Name</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Mode</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4 text-right">Allocated</th>
                    <th className="py-3 px-4 text-right">Unallocated</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.data.map((row: any) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{row.payment_number}</td>
                      <td className="py-2.5 px-4 text-slate-600">{new Date(row.payment_date).toLocaleDateString()}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-800">{row.party_name}</td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                          row.payment_type === 'RECEIPT' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {row.payment_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-600">{row.payment_mode}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900">₹{Number(row.amount).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-emerald-600 font-semibold">₹{Number(row.allocated_amount || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-amber-600 font-semibold">₹{Number(row.unallocated_amount || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 8. ANALYTICS TABLE */}
            {activeTab === 'analytics' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Product Name</th>
                    <th className="py-3 px-4">SKU</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Brand</th>
                    <th className="py-3 px-4 text-center">Total Invoices</th>
                    <th className="py-3 px-4 text-right">Total Qty Sold</th>
                    <th className="py-3 px-4 text-right">Total Sales Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.data.map((row: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-bold text-slate-900">{row.unique_item_name}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-600">{row.sku}</td>
                      <td className="py-2.5 px-4 text-slate-600">{row.category_name}</td>
                      <td className="py-2.5 px-4 text-slate-600">{row.brand_name}</td>
                      <td className="py-2.5 px-4 text-center font-bold">{row.invoice_count}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-blue-600">{row.total_quantity}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-emerald-600">₹{Number(row.total_amount).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Pagination Controls */}
        {reportData?.pagination && reportData.pagination.totalPages > 1 && (
          <div className="p-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
            <div>
              Showing page {reportData.pagination.page} of {reportData.pagination.totalPages} ({reportData.pagination.totalRecords} total records)
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-3 py-1 rounded-lg bg-white border border-slate-200 font-semibold disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={page >= reportData.pagination.totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 rounded-lg bg-white border border-slate-200 font-semibold disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
