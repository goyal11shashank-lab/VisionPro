import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  Plus,
  Search,
  RefreshCw,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Trash2,
  Filter,
  Calendar,
  Building2,
  ShieldAlert,
  Pencil,
  Loader2,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { PurchaseInvoice } from '../../types/index.js';
import { PurchaseInvoiceDetailModal } from '../../components/purchases/PurchaseInvoiceDetailModal.js';
import { CreatePurchaseInvoicePage } from './CreatePurchaseInvoicePage.js';

export const PurchaseInvoicesPage: React.FC = () => {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Views & Modals
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [confirmDeleteInvoice, setConfirmDeleteInvoice] = useState<{ id: string; invoiceNumber: string } | null>(null);

  const fetchInvoices = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      params.append('limit', '100');

      const data = await apiRequest<{ invoices: PurchaseInvoice[]; total: number }>(
        `/api/purchases/invoices?${params.toString()}`
      );
      setInvoices(data.invoices || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load purchase invoices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchInvoices();
  };

  const handleViewInvoice = async (invoiceId: string) => {
    try {
      const invoice = await apiRequest<PurchaseInvoice>(`/api/purchases/invoices/${invoiceId}`);
      setSelectedInvoice(invoice);
    } catch (err: any) {
      setError(err.message || 'Failed to load invoice details');
    }
  };

  const handleEditInvoice = (invoiceId: string) => {
    setEditingInvoiceId(invoiceId);
    setIsCreating(true);
  };

  const handleCancelInvoice = async (invoiceId: string, invoiceNumber: string) => {
    const reason = prompt(`Enter cancellation reason for Purchase Invoice #${invoiceNumber}:`);
    if (!reason || !reason.trim()) return;

    try {
      setLoading(true);
      await apiRequest(`/api/purchases/invoices/${invoiceId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      fetchInvoices();
      setSuccessMsg(`Purchase invoice ${invoiceNumber} cancelled successfully.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to cancel invoice');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (invoiceId: string, invoiceNumber: string) => {
    if (!invoiceId) {
      setError('Cannot delete invoice: missing invoice ID');
      return;
    }
    setConfirmDeleteInvoice({ id: invoiceId, invoiceNumber });
  };

  const handleExecuteDelete = async () => {
    if (!confirmDeleteInvoice || deletingInvoiceId) return;

    const { id, invoiceNumber } = confirmDeleteInvoice;
    try {
      setDeletingInvoiceId(id);
      setError(null);
      await apiRequest(`/api/purchases/invoices/${id}`, {
        method: 'DELETE',
      });
      setConfirmDeleteInvoice(null);
      await fetchInvoices();
      setSuccessMsg(`Purchase invoice #${invoiceNumber} deleted successfully.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete invoice');
    } finally {
      setDeletingInvoiceId(null);
    }
  };

  if (isCreating) {
    return (
      <CreatePurchaseInvoicePage
        editInvoiceId={editingInvoiceId || undefined}
        onBack={() => {
          setIsCreating(false);
          setEditingInvoiceId(null);
        }}
        onSuccess={(id) => {
          setIsCreating(false);
          setEditingInvoiceId(null);
          fetchInvoices();
          setSuccessMsg(
            editingInvoiceId
              ? 'Purchase invoice updated successfully.'
              : 'Purchase invoice created and processed successfully.'
          );
          setTimeout(() => setSuccessMsg(null), 5000);
        }}
      />
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'POSTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>POSTED</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3.5 h-3.5" />
            <span>CANCELLED</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3.5 h-3.5" />
            <span>DRAFT</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6" id="purchase-invoices-page-root">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-50 text-purple-600 border border-purple-100">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Purchase Invoices & Inwards</h1>
            <p className="text-sm text-slate-500">
              Procurement orders, GST tax invoices, batch inventory receipts, and supplier bills.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            id="btn-refresh-invoices"
            onClick={fetchInvoices}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            title="Refresh Invoices"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            id="btn-create-invoice"
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create Purchase Bill</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2">
          <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row gap-4 justify-between items-center">
        {/* Status Tabs */}
        <div className="flex items-center p-1 bg-slate-100/80 rounded-xl w-full md:w-auto">
          {(['ALL', 'DRAFT', 'POSTED', 'CANCELLED'] as const).map(status => (
            <button
              key={status}
              id={`tab-invoice-${status.toLowerCase()}`}
              onClick={() => setStatusFilter(status)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                statusFilter === status
                  ? 'bg-white text-purple-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {status === 'ALL' ? 'All Invoices' : status}
            </button>
          ))}
        </div>

        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            id="input-search-invoices"
            placeholder="Search by invoice #, bill #, vendor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600 transition-all"
          />
        </form>
      </div>

      {/* Invoices Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600" id="invoices-data-table">
            <thead className="bg-slate-50/80 text-xs font-semibold text-slate-600 uppercase border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Invoice #</th>
                <th className="px-4 py-3.5">Invoice Date</th>
                <th className="px-4 py-3.5">Supplier / Vendor</th>
                <th className="px-4 py-3.5">Vendor Bill #</th>
                <th className="px-4 py-3.5">GST Mode</th>
                <th className="px-4 py-3.5 text-right">Taxable (₹)</th>
                <th className="px-4 py-3.5 text-right">Grand Total (₹)</th>
                <th className="px-4 py-3.5 text-center">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-purple-600" />
                      <span>Loading purchase invoices...</span>
                    </div>
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <FileSpreadsheet className="w-8 h-8 text-slate-300" />
                      <span className="font-medium text-slate-600">No purchase invoices found</span>
                      <p className="text-xs text-slate-400">
                        {search ? 'Try adjusting your search query' : 'Click "Create Purchase Bill" to record an inward shipment.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-50/60 transition-colors" id={`row-invoice-${inv.id}`}>
                    {/* Invoice Number */}
                    <td className="px-5 py-4">
                      <div className="font-mono font-bold text-slate-900">{inv.invoiceNumber}</div>
                      <div className="text-[11px] text-slate-400">
                        {new Date(inv.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-4 text-xs font-medium text-slate-700">
                      {new Date(inv.invoiceDate).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>

                    {/* Supplier */}
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-900 text-xs">{inv.supplier?.name}</div>
                      <div className="text-[11px] font-mono text-purple-700">{inv.supplier?.partyCode}</div>
                    </td>

                    {/* Vendor Bill # */}
                    <td className="px-4 py-4 text-xs font-mono text-slate-600">
                      {inv.supplierInvoiceNumber || '—'}
                    </td>

                    {/* GST Mode */}
                    <td className="px-4 py-4 text-xs text-slate-500">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px]">
                        {inv.gstMode === 'INTRA_STATE' ? 'Intra (CGST+SGST)' : inv.gstMode === 'INTER_STATE' ? 'Inter (IGST)' : 'Exempt'}
                      </span>
                    </td>

                    {/* Taxable */}
                    <td className="px-4 py-4 text-right font-mono text-xs text-slate-700">
                      ₹{Number(inv.taxableAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>

                    {/* Grand Total */}
                    <td className="px-4 py-4 text-right font-mono font-bold text-xs text-purple-900">
                      ₹{Number(inv.grandTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4 text-center">
                      {getStatusBadge(inv.status)}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          id={`btn-view-invoice-${inv.id}`}
                          onClick={() => handleViewInvoice(inv.id)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View</span>
                        </button>
                        {inv.status !== 'CANCELLED' && (
                          <button
                            id={`btn-edit-invoice-${inv.id}`}
                            onClick={() => handleEditInvoice(inv.id)}
                            className="p-1 text-slate-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            title="Edit Invoice"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          id={`btn-delete-invoice-${inv.id}`}
                          onClick={() => handleDeleteClick(inv.id, inv.invoiceNumber)}
                          disabled={deletingInvoiceId === inv.id}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                          title="Delete Invoice"
                        >
                          {deletingInvoiceId === inv.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDeleteInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600 mb-4">
              <div className="p-3 bg-rose-50 rounded-xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Purchase Invoice</h3>
                <p className="text-xs text-slate-500 font-mono">Invoice #{confirmDeleteInvoice.invoiceNumber}</p>
              </div>
            </div>

            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              Are you sure you want to delete Purchase Invoice <strong className="font-semibold text-slate-900 font-mono">#{confirmDeleteInvoice.invoiceNumber}</strong>?
              This will permanently remove the purchase record.
            </p>

            <div className="flex items-center justify-end gap-3">
              <button
                id="btn-cancel-delete-modal"
                type="button"
                onClick={() => setConfirmDeleteInvoice(null)}
                disabled={Boolean(deletingInvoiceId)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-delete-modal"
                type="button"
                onClick={handleExecuteDelete}
                disabled={Boolean(deletingInvoiceId)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors shadow-sm shadow-rose-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deletingInvoiceId ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <PurchaseInvoiceDetailModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onRefresh={fetchInvoices}
          onEdit={selectedInvoice.status !== 'CANCELLED' ? handleEditInvoice : undefined}
        />
      )}
    </div>
  );
};
