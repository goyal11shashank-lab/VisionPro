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
  Printer,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { apiRequest, getAuthHeaders } from '../../api/client.js';
import { StockItemLedgerModal } from '../../components/inventory/StockItemLedgerModal.js';
import { PrintPreviewModal } from '../../components/print/PrintPreviewModal.js';
import { PrintableReport, ReportColumn } from '../../components/print/PrintableReport.js';
import { exportToCsv } from '../../utils/csvExporter.js';

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
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);
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

  // Tally-Style Stock Item Ledger Modal State
  const [ledgerItemId, setLedgerItemId] = useState<string | null>(null);
  const [ledgerItemName, setLedgerItemName] = useState<string>('');
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

  const getReportPrintConfig = (): {
    title: string;
    subtitle?: string;
    filtersSummary?: string;
    columns: ReportColumn[];
    data: any[];
    totalsRow?: Record<string, any>;
    orientation: 'portrait' | 'landscape';
  } => {
    const filtersSummary = `Date: ${startDate} to ${endDate}${searchQuery ? ` | Search: "${searchQuery}"` : ''}`;

    switch (activeTab) {
      case 'inventory': {
        const rows = Array.isArray(reportData?.data) ? reportData.data : [];
        const totalStock = rows.reduce((acc: number, r: any) => acc + (Number(r.physical_stock ?? r.physicalStock) || 0), 0);
        return {
          title: 'Inventory Stock Valuation Register',
          subtitle: `Status: ${inventoryStatus}`,
          filtersSummary,
          orientation: 'landscape',
          columns: [
            { header: 'Barcode', key: 'barcode', width: '13%' },
            { header: 'Product Name / SKU', key: 'unique_item_name', width: '22%' },
            { header: 'Category', key: 'category_name', width: '12%' },
            { header: 'Brand', key: 'brand_name', width: '12%' },
            { header: 'SPH', key: 'sph', align: 'center', width: '7%' },
            { header: 'CYL', key: 'cyl', align: 'center', width: '7%' },
            { header: 'AXIS', key: 'axis', align: 'center', width: '7%' },
            { header: 'Physical', key: 'physical_stock', align: 'right', width: '10%' },
            { header: 'MRP (₹)', key: 'mrp', align: 'right', width: '10%', format: (val: any) => val ? `₹${Number(val).toFixed(2)}` : '-' },
          ],
          data: rows,
          totalsRow: {
            unique_item_name: 'Total Physical Stock',
            physical_stock: totalStock,
          },
        };
      }
      case 'stock-ledger': {
        const rows = Array.isArray(reportData?.data) ? reportData.data : [];
        return {
          title: 'Stock Movement & Transaction Ledger',
          filtersSummary,
          orientation: 'landscape',
          columns: [
            { header: 'Date & Time', key: 'created_at', width: '15%', format: (v: any) => v ? new Date(v).toLocaleDateString('en-IN') : '-' },
            { header: 'Barcode', key: 'barcode', width: '13%' },
            { header: 'Product Name', key: 'unique_item_name', width: '24%' },
            { header: 'Type', key: 'transaction_type', width: '12%' },
            { header: 'Doc #', key: 'document_number', width: '12%' },
            { header: 'In', key: 'quantity_in', align: 'right', width: '8%' },
            { header: 'Out', key: 'quantity_out', align: 'right', width: '8%' },
            { header: 'Balance', key: 'balance_after', align: 'right', width: '8%' },
          ],
          data: rows,
        };
      }
      case 'sales': {
        const rows = Array.isArray(reportData?.data) ? reportData.data : [];
        const totTaxable = rows.reduce((acc: number, r: any) => acc + (Number(r.taxable_amount) || 0), 0);
        const totGrand = rows.reduce((acc: number, r: any) => acc + (Number(r.grand_total) || 0), 0);
        const totPaid = rows.reduce((acc: number, r: any) => acc + (Number(r.paid_amount) || 0), 0);
        const totBal = rows.reduce((acc: number, r: any) => acc + (Number(r.outstanding_balance) || 0), 0);
        return {
          title: `Sales Register (${salesSubTab})`,
          filtersSummary,
          orientation: 'landscape',
          columns: [
            { header: 'Invoice #', key: 'invoice_number', width: '14%' },
            { header: 'Date', key: 'invoice_date', width: '11%', format: (v: any) => v ? new Date(v).toLocaleDateString('en-IN') : '-' },
            { header: 'Customer Name', key: 'customer_name', width: '23%' },
            { header: 'Taxable (₹)', key: 'taxable_amount', align: 'right', width: '12%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
            { header: 'Grand Total (₹)', key: 'grand_total', align: 'right', width: '14%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
            { header: 'Paid (₹)', key: 'paid_amount', align: 'right', width: '12%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
            { header: 'Balance (₹)', key: 'outstanding_balance', align: 'right', width: '14%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
          ],
          data: rows,
          totalsRow: {
            customer_name: 'Total',
            taxable_amount: `₹${totTaxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
            grand_total: `₹${totGrand.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
            paid_amount: `₹${totPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
            outstanding_balance: `₹${totBal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
          },
        };
      }
      case 'purchases': {
        const rows = Array.isArray(reportData?.data) ? reportData.data : [];
        const totTaxable = rows.reduce((acc: number, r: any) => acc + (Number(r.taxable_amount) || 0), 0);
        const totGrand = rows.reduce((acc: number, r: any) => acc + (Number(r.grand_total) || 0), 0);
        const totPaid = rows.reduce((acc: number, r: any) => acc + (Number(r.paid_amount) || 0), 0);
        const totBal = rows.reduce((acc: number, r: any) => acc + (Number(r.outstanding_balance) || 0), 0);
        return {
          title: `Purchase Inwards Register (${purchaseSubTab})`,
          filtersSummary,
          orientation: 'landscape',
          columns: [
            { header: 'Bill / Inv #', key: 'invoice_number', width: '14%' },
            { header: 'Date', key: 'invoice_date', width: '11%', format: (v: any) => v ? new Date(v).toLocaleDateString('en-IN') : '-' },
            { header: 'Supplier Name', key: 'supplier_name', width: '23%' },
            { header: 'Taxable (₹)', key: 'taxable_amount', align: 'right', width: '12%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
            { header: 'Grand Total (₹)', key: 'grand_total', align: 'right', width: '14%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
            { header: 'Paid (₹)', key: 'paid_amount', align: 'right', width: '12%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
            { header: 'Balance (₹)', key: 'outstanding_balance', align: 'right', width: '14%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
          ],
          data: rows,
          totalsRow: {
            supplier_name: 'Total',
            taxable_amount: `₹${totTaxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
            grand_total: `₹${totGrand.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
            paid_amount: `₹${totPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
            outstanding_balance: `₹${totBal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
          },
        };
      }
      case 'outstanding': {
        const rows = Array.isArray(reportData?.parties) ? reportData.parties : Array.isArray(reportData?.data) ? reportData.data : [];
        const totOut = rows.reduce((acc: number, r: any) => acc + (Number(r.outstanding_balance) || 0), 0);
        const totOver = rows.reduce((acc: number, r: any) => acc + (Number(r.overdue_balance) || 0), 0);
        return {
          title: `Outstanding Aging - ${outstandingType === 'CUSTOMER' ? 'Sundry Debtors' : 'Sundry Creditors'}`,
          filtersSummary,
          orientation: 'portrait',
          columns: [
            { header: 'Party Code', key: 'party_code', width: '15%' },
            { header: 'Party Name', key: 'name', width: '30%' },
            { header: 'Mobile', key: 'mobile', width: '15%' },
            { header: 'Credit Limit (₹)', key: 'credit_limit', align: 'right', width: '15%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN')}` },
            { header: 'Outstanding (₹)', key: 'outstanding_balance', align: 'right', width: '15%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN')}` },
            { header: 'Overdue (₹)', key: 'overdue_balance', align: 'right', width: '15%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN')}` },
          ],
          data: rows,
          totalsRow: {
            name: 'Total Outstanding',
            outstanding_balance: `₹${totOut.toLocaleString('en-IN')}`,
            overdue_balance: `₹${totOver.toLocaleString('en-IN')}`,
          },
        };
      }
      case 'party-statement': {
        const partyName = reportData?.party?.name || 'Party';
        const rows = Array.isArray(reportData?.rows) ? reportData.rows : [];
        const totDebit = rows.reduce((acc: number, r: any) => acc + (Number(r.debit) || 0), 0);
        const totCredit = rows.reduce((acc: number, r: any) => acc + (Number(r.credit) || 0), 0);
        return {
          title: `Account Statement / Ledger - ${partyName}`,
          subtitle: `Opening: ₹${Number(reportData?.openingBalance || 0).toLocaleString()} | Closing: ₹${Number(reportData?.closingBalance || 0).toLocaleString()}`,
          filtersSummary,
          orientation: 'portrait',
          columns: [
            { header: 'Date', key: 'created_at', width: '14%', format: (v: any) => v ? new Date(v).toLocaleDateString('en-IN') : '-' },
            { header: 'Type', key: 'transaction_type', width: '15%' },
            { header: 'Document #', key: 'document_number', width: '15%' },
            { header: 'Debit (₹)', key: 'debit', align: 'right', width: '16%', format: (v: any) => Number(v) > 0 ? `₹${Number(v).toLocaleString('en-IN')}` : '-' },
            { header: 'Credit (₹)', key: 'credit', align: 'right', width: '16%', format: (v: any) => Number(v) > 0 ? `₹${Number(v).toLocaleString('en-IN')}` : '-' },
            { header: 'Balance (₹)', key: 'balance', align: 'right', width: '16%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN')}` },
          ],
          data: rows,
          totalsRow: {
            transaction_type: 'Total',
            debit: `₹${totDebit.toLocaleString('en-IN')}`,
            credit: `₹${totCredit.toLocaleString('en-IN')}`,
            balance: `₹${Number(reportData?.closingBalance || 0).toLocaleString('en-IN')}`,
          },
        };
      }
      case 'payments': {
        const rows = Array.isArray(reportData?.data) ? reportData.data : [];
        const totAmt = rows.reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0);
        return {
          title: `Payment & Collection Register (${paymentType})`,
          filtersSummary,
          orientation: 'portrait',
          columns: [
            { header: 'Payment #', key: 'payment_number', width: '16%' },
            { header: 'Date', key: 'payment_date', width: '14%', format: (v: any) => v ? new Date(v).toLocaleDateString('en-IN') : '-' },
            { header: 'Party Name', key: 'party_name', width: '26%' },
            { header: 'Mode', key: 'payment_mode', width: '14%' },
            { header: 'Amount (₹)', key: 'amount', align: 'right', width: '16%', format: (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
            { header: 'Status', key: 'status', align: 'center', width: '14%' },
          ],
          data: rows,
          totalsRow: {
            party_name: 'Total Amount',
            amount: `₹${totAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
          },
        };
      }
      default: {
        return {
          title: 'Business Report',
          filtersSummary,
          orientation: 'portrait',
          columns: [{ header: 'Record', key: 'id' }],
          data: Array.isArray(reportData?.data) ? reportData.data : [],
        };
      }
    }
  };

  const handleExportCsv = () => {
    const config = getReportPrintConfig();
    exportToCsv({
      filename: `${activeTab}_report_${new Date().toISOString().split('T')[0]}`,
      reportTitle: config.title,
      businessName: currentBusiness?.name,
      filtersSummary: config.filtersSummary,
      columns: config.columns.map(c => ({
        header: c.header,
        key: c.key,
      })),
      data: config.data,
    });
  };

  // Check whether report data has records
  const hasReportRecords = () => {
    if (!reportData) return false;
    if (Array.isArray(reportData)) return reportData.length > 0;
    if (Array.isArray(reportData.data) && reportData.data.length > 0) return true;
    if (Array.isArray(reportData.parties) && reportData.parties.length > 0) return true;
    if (Array.isArray(reportData.rows) && reportData.rows.length > 0) return true;
    if (Array.isArray(reportData.invoices) && reportData.invoices.length > 0) return true;
    if (Array.isArray(reportData.lines) && reportData.lines.length > 0) return true;
    if (Array.isArray(reportData.returns) && reportData.returns.length > 0) return true;
    if (Array.isArray(reportData.entries) && reportData.entries.length > 0) return true;
    if (Array.isArray(reportData.products) && reportData.products.length > 0) return true;
    return false;
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

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchReport}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors flex items-center gap-1.5"
            title="Refresh current report dataset"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            id="btn-print-preview-report"
            onClick={() => setIsPrintPreviewOpen(true)}
            disabled={loading || !hasReportRecords()}
            className="px-3.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold border border-blue-200 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Open printable formatted preview with direct PDF and printer output"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Preview</span>
          </button>
          <button
            id="btn-export-report-csv"
            onClick={handleExportCsv}
            disabled={loading || !hasReportRecords()}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-300 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Export filtered records to standard CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
          <button
            id="btn-export-report-excel"
            onClick={handleExportExcel}
            disabled={exporting || loading || !hasReportRecords()}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-all flex items-center gap-2 disabled:opacity-50"
            title="Export to formatted Microsoft Excel XLSX workbook"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{exporting ? 'Generating XLSX...' : 'Export Excel'}</span>
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
                setReportData(null);
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
                onClick={() => { setSalesSubTab('SUMMARY'); setReportData(null); setPage(1); }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  salesSubTab === 'SUMMARY' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Invoices Summary
              </button>
              <button
                onClick={() => { setSalesSubTab('DETAILS'); setReportData(null); setPage(1); }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  salesSubTab === 'DETAILS' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Line-Item Drilldown
              </button>
              <button
                onClick={() => { setSalesSubTab('RETURNS'); setReportData(null); setPage(1); }}
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
                onClick={() => { setPurchaseSubTab('SUMMARY'); setReportData(null); setPage(1); }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  purchaseSubTab === 'SUMMARY' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Purchase Invoices
              </button>
              <button
                onClick={() => { setPurchaseSubTab('DETAILS'); setReportData(null); setPage(1); }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  purchaseSubTab === 'DETAILS' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Line-Item Drilldown
              </button>
              <button
                onClick={() => { setPurchaseSubTab('RETURNS'); setReportData(null); setPage(1); }}
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
                onClick={() => { setOutstandingType('CUSTOMER'); setReportData(null); setPage(1); }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  outstandingType === 'CUSTOMER' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                Customer Receivables
              </button>
              <button
                onClick={() => { setOutstandingType('SUPPLIER'); setReportData(null); setPage(1); }}
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
                {(partiesList || []).map((p, pIdx) => (
                  <option key={p.id || `party-opt-${pIdx}`} value={p.id}>
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
      {reportData?.summary && typeof reportData.summary === 'object' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(reportData.summary).map(([key, val]: any, sIdx: number) => {
            if (typeof val === 'object' && val !== null) return null;
            return (
              <div key={key || `summary-card-${sIdx}`} className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {String(key || '').replace(/([A-Z])/g, ' $1').trim()}
                </div>
                <div className="text-lg md:text-xl font-bold text-slate-900 mt-1">
                  {typeof val === 'number' && (key.toLowerCase().includes('amount') || key.toLowerCase().includes('total') || key.toLowerCase().includes('balance'))
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
        ) : !hasReportRecords() ? (
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
                    <th className="py-3 px-4 text-right">Stock</th>
                    <th className="py-3 px-4 text-right">Reserved</th>
                    <th className="py-3 px-4 text-right">Available</th>
                    <th className="py-3 px-4 text-right">MRP</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(reportData?.data || []).map((row: any, idx: number) => (
                    <tr key={row.batch_id || row.id || `inv-row-${idx}`} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{row.barcode}</td>
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          onClick={() => {
                            setLedgerItemId(row.unique_item_id || row.item_id);
                            setLedgerItemName(row.unique_item_name);
                          }}
                          className="font-semibold text-slate-800 hover:text-blue-600 hover:underline cursor-pointer text-left inline-block"
                          title="Click to view Tally-style Stock Item Ledger"
                        >
                          {row.unique_item_name}
                        </button>
                        <div className="text-[10px] text-slate-400 font-mono">SKU: {row.sku}</div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{row.category_name}</td>
                      <td className="py-2.5 px-4 text-slate-600">{row.brand_name}</td>
                      <td className="py-2.5 px-4 text-center font-mono">{row.sph ?? '-'}</td>
                      <td className="py-2.5 px-4 text-center font-mono">{row.cyl ?? '-'}</td>
                      <td className="py-2.5 px-4 text-center font-mono">{row.axis ?? '-'}</td>
                      <td className="py-2.5 px-4 text-center font-mono">{row.add ?? '-'}</td>
                      <td className="py-2.5 px-4 text-center font-mono">{row.side ?? '-'}</td>
                      <td className={`py-2.5 px-4 text-right font-bold ${
                        Number(row.physical_stock ?? row.physicalStock ?? 0) < 0
                          ? 'text-rose-600 bg-rose-50/50'
                          : 'text-slate-900'
                      }`}>
                        {row.physical_stock ?? row.physicalStock}
                      </td>
                      <td className="py-2.5 px-4 text-right text-amber-600 font-semibold">{row.reserved_stock ?? row.reservedStock}</td>
                      <td className={`py-2.5 px-4 text-right font-bold ${
                        Number(row.available_stock ?? row.availableStock ?? 0) < 0
                          ? 'text-rose-600 bg-rose-50/50'
                          : 'text-emerald-600'
                      }`}>
                        {row.available_stock ?? row.availableStock}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-800">₹{Number(row.mrp || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-center">
                        {(() => {
                          const statusStr = row.stock_status || row.stockStatus || (
                            (row.physical_stock ?? row.physicalStock ?? 0) < 0 ? 'NEGATIVE_STOCK' :
                            (row.physical_stock ?? row.physicalStock ?? 0) === 0 ? 'ZERO_STOCK' :
                            row.isLowStock ? 'LOW_STOCK' : 'IN_STOCK'
                          );
                          return (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                statusStr === 'IN_STOCK'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : statusStr === 'LOW_STOCK'
                                  ? 'bg-amber-100 text-amber-700'
                                  : statusStr === 'ZERO_STOCK'
                                  ? 'bg-slate-100 text-slate-600'
                                  : 'bg-rose-100 text-rose-700'
                              }`}
                            >
                              {String(statusStr).replace(/_/g, ' ')}
                            </span>
                          );
                        })()}
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
                  {(reportData?.data || []).map((row: any, idx: number) => (
                    <tr key={row.id || `sl-row-${idx}`} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-slate-600">{new Date(row.created_at).toLocaleString()}</td>
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{row.barcode}</td>
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          onClick={() => {
                            setLedgerItemId(row.unique_item_id || row.item_id);
                            setLedgerItemName(row.unique_item_name);
                          }}
                          className="font-semibold text-slate-800 hover:text-blue-600 hover:underline cursor-pointer text-left inline-block"
                          title="Click to view Tally-style Stock Item Ledger"
                        >
                          {row.unique_item_name}
                        </button>
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

            {/* 3. SALES REGISTER TABLE - SUMMARY */}
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
                  {(reportData?.data || []).map((row: any, idx: number) => (
                    <tr key={row.id || `sales-sum-${idx}`} className="hover:bg-slate-50/70 transition-colors">
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

            {/* 3b. SALES LINE-ITEM DRILLDOWN TABLE */}
            {activeTab === 'sales' && salesSubTab === 'DETAILS' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Invoice #</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Item / SKU</th>
                    <th className="py-3 px-4">Barcode / Power</th>
                    <th className="py-3 px-4 text-right">Qty</th>
                    <th className="py-3 px-4 text-right">Unit Price</th>
                    <th className="py-3 px-4 text-right">Disc %</th>
                    <th className="py-3 px-4 text-right">Tax Rate</th>
                    <th className="py-3 px-4 text-right">Tax Amt</th>
                    <th className="py-3 px-4 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(reportData?.data || []).map((row: any, idx: number) => (
                    <tr key={row.lineId || row.id || `sales-item-${idx}`} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-bold text-blue-600">{row.invoiceNumber || row.invoice_number}</td>
                      <td className="py-2.5 px-4 text-slate-600">{row.invoiceDate ? new Date(row.invoiceDate).toLocaleDateString() : '-'}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{row.customerName || row.customer_name}</td>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">{row.uniqueItemName || row.unique_item_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">SKU: {row.sku}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono">
                        <div className="font-bold text-slate-800">{row.barcode || '-'}</div>
                        <div className="text-[10px] text-slate-500">{row.power || '-'}</div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900">{row.quantity}</td>
                      <td className="py-2.5 px-4 text-right">₹{Number(row.unitPrice || row.unit_price || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-slate-500">{row.discountPercent || row.discount_percent || 0}%</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{row.taxRate || row.tax_rate || 0}%</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">₹{Number(row.taxAmount || row.tax_amount || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900">₹{Number(row.totalAmount || row.total_amount || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 3c. SALES RETURNS (CREDIT NOTES) TABLE */}
            {activeTab === 'sales' && salesSubTab === 'RETURNS' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Return #</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4 text-right">Taxable</th>
                    <th className="py-3 px-4 text-right">Tax Amount</th>
                    <th className="py-3 px-4 text-right">Grand Total (Refund)</th>
                    <th className="py-3 px-4">Reason</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(reportData?.data || []).map((row: any, idx: number) => (
                    <tr key={row.id || `sales-ret-${idx}`} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-bold text-rose-600">{row.returnNumber || row.return_number}</td>
                      <td className="py-2.5 px-4 text-slate-600">{row.returnDate ? new Date(row.returnDate).toLocaleDateString() : '-'}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{row.partyName || row.party_name}</td>
                      <td className="py-2.5 px-4 text-right">₹{Number(row.subtotal || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">₹{Number(row.taxAmount || row.tax_amount || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-rose-600">₹{Number(row.grandTotal || row.grand_total || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-slate-500 max-w-xs truncate">{row.reason || '-'}</td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 4. PURCHASE REGISTER TABLE - SUMMARY */}
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
                  {(reportData?.data || []).map((row: any, idx: number) => (
                    <tr key={row.id || `purch-sum-${idx}`} className="hover:bg-slate-50/70 transition-colors">
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

            {/* 4b. PURCHASE LINE-ITEM DRILLDOWN TABLE */}
            {activeTab === 'purchases' && purchaseSubTab === 'DETAILS' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Bill #</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Supplier</th>
                    <th className="py-3 px-4">Item / SKU</th>
                    <th className="py-3 px-4">Barcode / Power</th>
                    <th className="py-3 px-4 text-right">Qty</th>
                    <th className="py-3 px-4 text-right">Unit Cost</th>
                    <th className="py-3 px-4 text-right">Disc %</th>
                    <th className="py-3 px-4 text-right">Tax Rate</th>
                    <th className="py-3 px-4 text-right">Tax Amt</th>
                    <th className="py-3 px-4 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(reportData?.data || []).map((row: any, idx: number) => (
                    <tr key={row.lineId || row.id || `purch-item-${idx}`} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-bold text-indigo-600">{row.invoiceNumber || row.invoice_number}</td>
                      <td className="py-2.5 px-4 text-slate-600">{row.invoiceDate ? new Date(row.invoiceDate).toLocaleDateString() : '-'}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{row.supplierName || row.supplier_name}</td>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">{row.uniqueItemName || row.unique_item_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">SKU: {row.sku}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono">
                        <div className="font-bold text-slate-800">{row.barcode || '-'}</div>
                        <div className="text-[10px] text-slate-500">{row.power || '-'}</div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900">{row.quantity}</td>
                      <td className="py-2.5 px-4 text-right">₹{Number(row.unitCost || row.unit_cost || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-slate-500">{row.discountPercent || row.discount_percent || 0}%</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{row.taxRate || row.tax_rate || 0}%</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">₹{Number(row.taxAmount || row.tax_amount || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900">₹{Number(row.totalAmount || row.total_amount || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 4c. PURCHASE RETURNS (DEBIT NOTES) TABLE */}
            {activeTab === 'purchases' && purchaseSubTab === 'RETURNS' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Return #</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Supplier</th>
                    <th className="py-3 px-4 text-right">Taxable</th>
                    <th className="py-3 px-4 text-right">Tax Amount</th>
                    <th className="py-3 px-4 text-right">Grand Total (Debit)</th>
                    <th className="py-3 px-4">Reason</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(reportData?.data || []).map((row: any, idx: number) => (
                    <tr key={row.id || `purch-ret-${idx}`} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-bold text-indigo-600">{row.returnNumber || row.return_number}</td>
                      <td className="py-2.5 px-4 text-slate-600">{row.returnDate ? new Date(row.returnDate).toLocaleDateString() : '-'}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{row.partyName || row.party_name}</td>
                      <td className="py-2.5 px-4 text-right">₹{Number(row.subtotal || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">₹{Number(row.taxAmount || row.tax_amount || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-indigo-600">₹{Number(row.grandTotal || row.grand_total || 0).toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-slate-500 max-w-xs truncate">{row.reason || '-'}</td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
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
                  {(reportData.parties || reportData.data || []).map((p: any, idx: number) => (
                    <tr key={p.id || p.party_id || `out-party-${idx}`} className="hover:bg-slate-50/70 transition-colors">
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
                    {(reportData?.rows || reportData?.entries || []).map((r: any, idx: number) => (
                      <tr key={r.id || `stmt-row-${idx}`} className="hover:bg-slate-50/70 transition-colors">
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
                  {(reportData?.data || []).map((row: any, idx: number) => (
                    <tr key={row.id || row.payment_id || `pmt-row-${idx}`} className="hover:bg-slate-50/70 transition-colors">
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
                  {(reportData?.data || []).map((row: any, idx: number) => (
                    <tr key={row.unique_item_id || row.id || row.sku || `analytics-${idx}`} className="hover:bg-slate-50/70 transition-colors">
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

      {/* Tally-Style Stock Item Ledger Modal */}
      {ledgerItemId && (
        <StockItemLedgerModal
          itemId={ledgerItemId}
          itemName={ledgerItemName}
          onClose={() => setLedgerItemId(null)}
        />
      )}

      {/* Printable Report Preview Modal */}
      {isPrintPreviewOpen && (
        <PrintPreviewModal
          isOpen={isPrintPreviewOpen}
          onClose={() => setIsPrintPreviewOpen(false)}
          title={getReportPrintConfig().title}
          filename={`${activeTab}_report_${new Date().toISOString().slice(0, 10)}`}
          defaultOrientation={getReportPrintConfig().orientation}
        >
          {({ documentId }) => {
            const config = getReportPrintConfig();
            return (
              <PrintableReport
                id={documentId}
                business={currentBusiness}
                reportTitle={config.title}
                subtitle={config.subtitle}
                filtersSummary={config.filtersSummary}
                columns={config.columns}
                data={config.data}
                totals={config.totalsRow}
                orientation={config.orientation}
              />
            );
          }}
        </PrintPreviewModal>
      )}
    </div>
  );
};
