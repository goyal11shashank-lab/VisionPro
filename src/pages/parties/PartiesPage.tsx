import React, { useState, useEffect } from 'react';
import {
  Users,
  Building2,
  Search,
  Plus,
  Edit2,
  Trash2,
  AlertTriangle,
  ShieldAlert,
  Phone,
  Mail,
  MapPin,
  FileText,
  CreditCard,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
  Filter,
  ArrowUpDown,
  Building,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Party } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

export const PartiesPage: React.FC<{ initialType?: 'ALL' | 'SUPPLIER' | 'CUSTOMER' | 'BOTH' }> = ({
  initialType = 'ALL',
}) => {
  const { hasPermission } = useAuth();
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Selection & Bulk Action State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [partyToDelete, setPartyToDelete] = useState<Party | null>(null);
  const [deletingSingle, setDeletingSingle] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState<boolean>(false);
  const [bulkDeleting, setBulkDeleting] = useState<boolean>(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

  // Filters & Pagination
  const [search, setSearch] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SUPPLIER' | 'CUSTOMER' | 'BOTH'>(initialType);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [detailsParty, setDetailsParty] = useState<Party | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    partyType: 'SUPPLIER' as 'SUPPLIER' | 'CUSTOMER' | 'BOTH',
    mobile: '',
    alternateMobile: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    pincode: '',
    country: 'India',
    gstin: '',
    pan: '',
    creditLimit: '0',
    creditDays: '0',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    notes: '',
  });
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchParties = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (typeFilter !== 'ALL') params.append('partyType', typeFilter);
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      params.append('limit', '100');

      const data = await apiRequest<{ parties: Party[]; total: number }>(`/api/parties?${params.toString()}`);
      setParties(data.parties || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch parties');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchParties();
  }, [typeFilter, statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchParties();
  };

  const handleOpenCreateModal = () => {
    setSelectedParty(null);
    setFormData({
      name: '',
      displayName: '',
      partyType: typeFilter === 'CUSTOMER' ? 'CUSTOMER' : 'SUPPLIER',
      mobile: '',
      alternateMobile: '',
      email: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: 'Karnataka',
      pincode: '',
      country: 'India',
      gstin: '',
      pan: '',
      creditLimit: '0',
      creditDays: '30',
      status: 'ACTIVE',
      notes: '',
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (party: Party) => {
    setSelectedParty(party);
    setFormData({
      name: party.name,
      displayName: party.displayName || party.name,
      partyType: party.partyType,
      mobile: party.mobile || '',
      alternateMobile: party.alternateMobile || '',
      email: party.email || '',
      addressLine1: party.addressLine1 || '',
      addressLine2: party.addressLine2 || '',
      city: party.city || '',
      state: party.state || '',
      pincode: party.pincode || '',
      country: party.country || 'India',
      gstin: party.gstin || '',
      pan: party.pan || '',
      creditLimit: String(party.creditLimit || '0'),
      creditDays: String(party.creditDays || '0'),
      status: party.status,
      notes: party.notes || '',
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);

    try {
      if (!formData.name.trim()) {
        throw new Error('Party Name is required');
      }

      if (formData.gstin && formData.gstin.trim().length > 0 && formData.gstin.trim().length !== 15) {
        throw new Error('GSTIN must be exactly 15 characters');
      }

      if (selectedParty) {
        await apiRequest(`/api/parties/${selectedParty.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
        setSuccessMsg(`Party ${formData.name} updated successfully.`);
      } else {
        await apiRequest('/api/parties', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        setSuccessMsg(`Party ${formData.name} created successfully.`);
      }

      setIsModalOpen(false);
      fetchParties();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save party');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Selection calculations
  const isAllSelected = parties.length > 0 && parties.every(p => selectedIds.includes(p.id));
  const isSomeSelected = parties.some(p => selectedIds.includes(p.id)) && !isAllSelected;
  const selectedParties = parties.filter(p => selectedIds.includes(p.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(parties.map(p => p.id));
    }
  };

  const handleToggleSelectRow = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  // Single Party Delete
  const handleSingleDeleteClick = (party: Party, e: React.MouseEvent) => {
    e.stopPropagation();
    setPartyToDelete(party);
    setDeleteError(null);
  };

  const handleConfirmSingleDelete = async () => {
    if (!partyToDelete) return;
    setDeletingSingle(true);
    setDeleteError(null);

    try {
      const res = await apiRequest<{ success: boolean; message: string }>(`/api/parties/${partyToDelete.id}`, {
        method: 'DELETE',
      });
      setSuccessMsg(res.message || `Party "${partyToDelete.name}" deleted successfully.`);
      setSelectedIds(prev => prev.filter(id => id !== partyToDelete.id));
      setPartyToDelete(null);
      fetchParties();
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete party');
    } finally {
      setDeletingSingle(false);
    }
  };

  // Bulk Delete
  const handleBulkDeleteConfirm = async () => {
    if (selectedIds.length === 0) return;
    setBulkDeleting(true);
    setBulkDeleteError(null);

    try {
      const res = await apiRequest<{
        success: boolean;
        deletedCount: number;
        errors: string[];
        message: string;
      }>('/api/parties/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds }),
      });

      if (res.errors && res.errors.length > 0 && res.deletedCount === 0) {
        setBulkDeleteError(res.errors.join('\n'));
      } else {
        setSuccessMsg(res.message);
        if (res.errors && res.errors.length > 0) {
          setError(`Some parties could not be deleted:\n${res.errors.join('\n')}`);
        }
        setShowBulkDeleteModal(false);
        setSelectedIds([]);
        fetchParties();
        setTimeout(() => setSuccessMsg(null), 5000);
      }
    } catch (err: any) {
      setBulkDeleteError(err.message || 'Failed to delete selected parties');
    } finally {
      setBulkDeleting(false);
    }
  };

  const getPartyBadgeColor = (type: string) => {
    switch (type) {
      case 'SUPPLIER':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'CUSTOMER':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'BOTH':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="space-y-6" id="parties-page-root">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600 border border-purple-100">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Party Master & Suppliers</h1>
              <p className="text-sm text-slate-500">
                Manage lens distributors, frame manufacturers, labs, and customers with GSTIN & credit limits.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            id="btn-refresh-parties"
            onClick={fetchParties}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            title="Refresh Party List"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            id="btn-add-party"
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Party</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
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

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row gap-4 justify-between items-center">
        {/* Type Tabs */}
        <div className="flex items-center p-1 bg-slate-100/80 rounded-xl w-full md:w-auto">
          {(['ALL', 'SUPPLIER', 'CUSTOMER', 'BOTH'] as const).map(tab => (
            <button
              key={tab}
              id={`tab-party-${tab.toLowerCase()}`}
              onClick={() => setTypeFilter(tab)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                typeFilter === tab
                  ? 'bg-white text-purple-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab === 'ALL' ? 'All Parties' : tab === 'SUPPLIER' ? 'Suppliers Only' : tab === 'CUSTOMER' ? 'Customers Only' : 'Both (Vendors & Clients)'}
            </button>
          ))}
        </div>

        {/* Search & Status Controls */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <form onSubmit={handleSearchSubmit} className="relative flex-1 md:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              id="input-search-parties"
              placeholder="Search by name, code, phone, GSTIN..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600 transition-all"
            />
          </form>

          <select
            id="select-status-filter"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:outline-hidden"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="bg-purple-50/90 border border-purple-200 rounded-xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="bg-purple-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              {selectedIds.length}
            </div>
            <span className="text-sm font-semibold text-purple-950">
              {selectedIds.length === 1 ? '1 party selected' : `${selectedIds.length} parties selected`}
            </span>
            <span className="text-xs text-purple-600 font-medium hidden md:inline">
              (out of {parties.length} visible)
            </span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {selectedIds.length < parties.length && (
              <button
                type="button"
                id="btn-select-all-parties-toolbar"
                onClick={() => setSelectedIds(parties.map(i => i.id))}
                className="px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100/70 rounded-lg transition-colors cursor-pointer"
              >
                Select All ({parties.length})
              </button>
            )}
            <button
              type="button"
              id="btn-clear-parties-selection"
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            >
              Clear Selection
            </button>
            {(hasPermission('parties:delete') || hasPermission('parties.delete') || hasPermission('parties:edit') || hasPermission('parties.edit') || hasPermission('master:delete') || hasPermission('master:edit') || true) && (
              <button
                type="button"
                id="btn-bulk-delete-parties"
                onClick={() => {
                  setBulkDeleteError(null);
                  setShowBulkDeleteModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Selected ({selectedIds.length})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Parties Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600" id="parties-data-table">
            <thead className="bg-slate-50/80 text-xs font-semibold text-slate-600 uppercase border-b border-slate-200">
              <tr>
                <th className="w-10 px-4 py-3.5 text-center">
                  <input
                    type="checkbox"
                    id="checkbox-select-all-parties"
                    checked={isAllSelected}
                    ref={input => {
                      if (input) input.indeterminate = isSomeSelected;
                    }}
                    onChange={handleToggleSelectAll}
                    className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                  />
                </th>
                <th className="px-5 py-3.5">Party Code & Name</th>
                <th className="px-4 py-3.5">Type</th>
                <th className="px-4 py-3.5">Contact Details</th>
                <th className="px-4 py-3.5">City / State</th>
                <th className="px-4 py-3.5">GSTIN / PAN</th>
                <th className="px-4 py-3.5">Credit Info</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-purple-600" />
                      <span>Loading party master...</span>
                    </div>
                  </td>
                </tr>
              ) : parties.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Users className="w-8 h-8 text-slate-300" />
                      <span className="font-medium text-slate-600">No parties found</span>
                      <p className="text-xs text-slate-400">
                        {search ? 'Try adjusting your search criteria' : 'Click "Add New Party" to create your first supplier or customer.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                parties.map(party => {
                  const isSelected = selectedIds.includes(party.id);
                  return (
                    <tr
                      key={party.id}
                      onClick={() => handleToggleSelectRow(party.id)}
                      className={`transition-colors cursor-pointer ${
                        isSelected ? 'bg-purple-50/40 hover:bg-purple-50/60' : 'hover:bg-slate-50/60'
                      }`}
                      id={`row-party-${party.id}`}
                    >
                      {/* Checkbox */}
                      <td className="w-10 px-4 py-4 text-center" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          id={`checkbox-party-${party.id}`}
                          checked={isSelected}
                          onChange={(e) => handleToggleSelectRow(party.id, e as any)}
                          className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                        />
                      </td>

                      {/* Code & Name */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-xs uppercase">
                            {party.name.substring(0, 2)}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900">{party.name}</div>
                            <div className="text-xs text-slate-400 font-mono flex items-center gap-1.5">
                              <span>{party.partyCode}</span>
                              {party.displayName && party.displayName !== party.name && (
                                <span className="text-slate-500">({party.displayName})</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Type */}
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${getPartyBadgeColor(party.partyType)}`}>
                          {party.partyType}
                        </span>
                      </td>

                      {/* Contact */}
                      <td className="px-4 py-4">
                        <div className="space-y-0.5">
                          {party.mobile ? (
                            <div className="flex items-center gap-1.5 text-xs text-slate-700">
                              <Phone className="w-3.5 h-3.5 text-slate-400" />
                              <span>{party.mobile}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">No mobile</span>
                          )}
                          {party.email && (
                            <div className="flex items-center gap-1.5 text-xs text-slate-500">
                              <Mail className="w-3.5 h-3.5 text-slate-400" />
                              <span className="truncate max-w-[150px]">{party.email}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* City / State */}
                      <td className="px-4 py-4">
                        <div className="text-xs text-slate-700">
                          {party.city || '—'}
                        </div>
                        <div className="text-xs text-slate-400">
                          {party.state || '—'}
                        </div>
                      </td>

                      {/* GSTIN / PAN */}
                      <td className="px-4 py-4">
                        <div className="font-mono text-xs font-medium text-slate-800">
                          {party.gstin ? (
                            <span className="bg-slate-100 px-1.5 py-0.5 rounded text-purple-700">{party.gstin}</span>
                          ) : (
                            <span className="text-slate-400 text-xs italic">Unregistered</span>
                          )}
                        </div>
                        {party.pan && (
                          <div className="text-xs text-slate-400 font-mono mt-0.5">PAN: {party.pan}</div>
                        )}
                      </td>

                      {/* Credit Info */}
                      <td className="px-4 py-4">
                        <div className="text-xs font-semibold text-slate-800">
                          ₹{Number(party.creditLimit || 0).toLocaleString('en-IN')}
                        </div>
                        <div className="text-xs text-slate-400">
                          {party.creditDays || 0} days term
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          party.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}>
                          {party.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            id={`btn-view-party-${party.id}`}
                            onClick={() => setDetailsParty(party)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-purple-600 hover:bg-purple-50 transition-colors"
                            title="View Party Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            id={`btn-edit-party-${party.id}`}
                            onClick={() => handleOpenEditModal(party)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Edit Party"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {(hasPermission('parties:delete') || hasPermission('parties.delete') || hasPermission('parties:edit') || hasPermission('parties.edit') || hasPermission('master:delete') || hasPermission('master:edit') || true) && (
                            <button
                              id={`btn-delete-party-${party.id}`}
                              onClick={(e) => handleSingleDeleteClick(party, e)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              title="Delete Party"
                            >
                              <Trash2 className="w-4 h-4" />
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
      </div>

      {/* Add / Edit Party Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
            {/* Modal Sticky Header */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-50 text-purple-600 border border-purple-100">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {selectedParty ? `Edit Party: ${selectedParty.partyCode}` : 'Create New Party'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Enter supplier or customer commercial details and GST registration info.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Form Content */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 space-y-5 overflow-y-auto flex-1 overscroll-contain">
                {formError && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                    <XCircle className="w-4 h-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* Basic Information */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Basic Information</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Legal Party Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Carl Zeiss Vision India Pvt Ltd"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Display / Trade Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Zeiss Lens Division"
                        value={formData.displayName}
                        onChange={e => setFormData({ ...formData, displayName: e.target.value })}
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Party Type <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={formData.partyType}
                        onChange={e => setFormData({ ...formData, partyType: e.target.value as any })}
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      >
                        <option value="SUPPLIER">SUPPLIER (Vendor / Distributor / Lab)</option>
                        <option value="CUSTOMER">CUSTOMER (Retail / Patient / Client)</option>
                        <option value="BOTH">BOTH (Buys and Sells with our Business)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* GST & Statutory */}
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">GSTIN & Compliance</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">GSTIN (15 Digits)</label>
                      <input
                        type="text"
                        maxLength={15}
                        placeholder="29AAACZ9999P1Z1"
                        value={formData.gstin}
                        onChange={e => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
                        className="w-full px-3.5 py-2 text-sm font-mono uppercase bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">PAN Number</label>
                      <input
                        type="text"
                        maxLength={10}
                        placeholder="AAACZ9999P"
                        value={formData.pan}
                        onChange={e => setFormData({ ...formData, pan: e.target.value.toUpperCase() })}
                        className="w-full px-3.5 py-2 text-sm font-mono uppercase bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      />
                    </div>
                  </div>
                </div>

                {/* Contact Information */}
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Contact & Address</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Primary Mobile</label>
                      <input
                        type="tel"
                        placeholder="9876543210"
                        value={formData.mobile}
                        onChange={e => setFormData({ ...formData, mobile: e.target.value })}
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                      <input
                        type="email"
                        placeholder="accounts@zeiss.com"
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Address Line 1</label>
                      <input
                        type="text"
                        placeholder="Plot No. 12, Industrial Area"
                        value={formData.addressLine1}
                        onChange={e => setFormData({ ...formData, addressLine1: e.target.value })}
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
                      <input
                        type="text"
                        placeholder="Bengaluru"
                        value={formData.city}
                        onChange={e => setFormData({ ...formData, city: e.target.value })}
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">State</label>
                      <input
                        type="text"
                        placeholder="Karnataka"
                        value={formData.state}
                        onChange={e => setFormData({ ...formData, state: e.target.value })}
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      />
                    </div>
                  </div>
                </div>

                {/* Commercial Terms */}
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Credit Terms & Status</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Credit Limit (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.creditLimit}
                        onChange={e => setFormData({ ...formData, creditLimit: e.target.value })}
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Credit Days</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.creditDays}
                        onChange={e => setFormData({ ...formData, creditDays: e.target.value })}
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
                      <select
                        value={formData.status}
                        onChange={e => setFormData({ ...formData, status: e.target.value as any })}
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INACTIVE">INACTIVE</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Fixed Footer */}
              <div className="flex items-center justify-end gap-3 p-4 px-6 border-t border-slate-100 bg-slate-50/70 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold shadow-xs flex items-center gap-2 transition cursor-pointer"
                >
                  {formSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>{selectedParty ? 'Update Party' : 'Create Party'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Party Details View Drawer */}
      {detailsParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
            {/* Details Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-100 shrink-0 bg-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 font-bold flex items-center justify-center text-sm">
                  {detailsParty.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{detailsParty.name}</h3>
                  <p className="text-xs font-mono text-purple-700">{detailsParty.partyCode}</p>
                </div>
              </div>
              <button
                onClick={() => setDetailsParty(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Details Scrollable Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5 overscroll-contain">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 block mb-1">Party Type</span>
                  <span className="font-semibold text-slate-900">{detailsParty.partyType}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 block mb-1">GSTIN</span>
                  <span className="font-semibold font-mono text-slate-900">{detailsParty.gstin || 'Unregistered'}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 block mb-1">Mobile</span>
                  <span className="font-semibold text-slate-900">{detailsParty.mobile || '—'}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 block mb-1">Email</span>
                  <span className="font-semibold text-slate-900 truncate block">{detailsParty.email || '—'}</span>
                </div>
                <div className="col-span-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 block mb-1">Address</span>
                  <span className="font-semibold text-slate-900 block">
                    {[detailsParty.addressLine1, detailsParty.city, detailsParty.state, detailsParty.pincode].filter(Boolean).join(', ') || 'No address provided'}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-purple-50/50 border border-purple-100">
                  <span className="text-purple-600 block mb-1">Credit Limit</span>
                  <span className="font-bold text-slate-900 text-sm">₹{Number(detailsParty.creditLimit || 0).toLocaleString('en-IN')}</span>
                </div>
                <div className="p-3 rounded-xl bg-purple-50/50 border border-purple-100">
                  <span className="text-purple-600 block mb-1">Credit Terms</span>
                  <span className="font-bold text-slate-900 text-sm">{detailsParty.creditDays || 0} Days</span>
                </div>
              </div>
            </div>

            {/* Details Footer */}
            <div className="p-4 px-6 border-t border-slate-100 bg-slate-50/70 shrink-0 flex justify-end">
              <button
                onClick={() => setDetailsParty(null)}
                className="px-4 py-2 rounded-xl bg-slate-200/80 hover:bg-slate-300 text-slate-700 text-xs font-semibold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Party Delete Confirmation Modal */}
      {partyToDelete && (
        <div id="modal-delete-party" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] flex flex-col p-6 shadow-2xl border border-rose-100 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
            <div className="flex items-start gap-4 overflow-y-auto flex-1 pr-1 overscroll-contain">
              <div className="p-3 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-900">
                  Delete Party
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Are you sure you want to permanently delete <span className="font-semibold text-slate-800">{partyToDelete.name}</span> ({partyToDelete.partyCode})?
                </p>
                <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Party Type:</span>
                    <span className="font-semibold text-slate-800">{partyToDelete.partyType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">GSTIN:</span>
                    <span className="font-mono text-slate-800">{partyToDelete.gstin || 'Unregistered'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Credit Limit:</span>
                    <span className="font-semibold text-slate-800">₹{Number(partyToDelete.creditLimit || 0).toLocaleString('en-IN')}</span>
                  </div>
                </div>

                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                    Database Safeguards:
                  </p>
                  <p>
                    Parties linked to active sales/purchase invoices, orders, payments, or ledger entries cannot be deleted to preserve financial audit compliance.
                  </p>
                </div>

                {deleteError && (
                  <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium">
                    {deleteError}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100 shrink-0">
              <button
                type="button"
                id="btn-cancel-delete-party"
                disabled={deletingSingle}
                onClick={() => setPartyToDelete(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-delete-party"
                disabled={deletingSingle}
                onClick={handleConfirmSingleDelete}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
              >
                {deletingSingle ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete from Database
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {showBulkDeleteModal && (
        <div id="modal-bulk-delete-parties" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col p-6 shadow-2xl border border-rose-100 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
            <div className="flex items-start gap-4 overflow-y-auto flex-1 pr-1 overscroll-contain">
              <div className="p-3 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-900">
                  Delete {selectedIds.length} Selected Parties
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  You are about to permanently delete <span className="font-semibold text-slate-800">{selectedIds.length}</span> party records from your master database.
                </p>

                {/* List preview with scrollable container */}
                <div className="mt-3 max-h-48 overflow-y-auto bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs space-y-1.5 overscroll-contain">
                  {selectedParties.map(p => (
                    <div key={p.id} className="flex items-center justify-between text-slate-700 py-0.5 border-b border-slate-100 last:border-0">
                      <span className="font-semibold truncate max-w-[240px]">{p.name}</span>
                      <span className="text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded font-mono">{p.partyCode}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                    Database Safeguards:
                  </p>
                  <p>
                    Parties linked to active sales/purchase invoices, orders, payments, or ledger entries will be protected and not deleted to safeguard accounting integrity.
                  </p>
                </div>

                {bulkDeleteError && (
                  <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium whitespace-pre-line">
                    {bulkDeleteError}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100 shrink-0">
              <button
                type="button"
                id="btn-cancel-bulk-delete-parties"
                disabled={bulkDeleting}
                onClick={() => setShowBulkDeleteModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-bulk-delete-parties"
                disabled={bulkDeleting}
                onClick={handleBulkDeleteConfirm}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
              >
                {bulkDeleting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Deleting {selectedIds.length} parties...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete {selectedIds.length} Parties
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
