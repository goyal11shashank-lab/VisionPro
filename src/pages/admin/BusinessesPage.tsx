import React, { useEffect, useState } from 'react';
import {
  Building2,
  Plus,
  Search,
  RefreshCw,
  Edit3,
  Users,
  AlertCircle,
  CheckCircle2,
  X,
  Shield,
  Trash2,
  Power,
  PowerOff,
  UserPlus,
  MapPin,
  FileText,
  BadgeCheck,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Business, Role, User } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

interface BusinessUserRecord {
  id: string;
  username: string;
  fullName: string;
  email?: string | null;
  mobile?: string | null;
  status: string;
  isSuperAdmin: boolean;
  isDefault: boolean;
  assignedAt: string;
  roleId?: string | null;
  roleName?: string | null;
  roleCode?: string | null;
}

export const BusinessesPage: React.FC = () => {
  const { user: currentUser, currentBusiness, refreshUser } = useAuth();
  const [businessesList, setBusinessesList] = useState<Business[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Multi-Selection State for Bulk Actions
  const [selectedBizIds, setSelectedBizIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState<boolean>(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);
  const [bulkDeleteResult, setBulkDeleteResult] = useState<{
    totalRequested: number;
    deletedCount: number;
    failedCount: number;
    deletedIds: string[];
    blockedBusinesses: Array<{
      id: string;
      name: string;
      reason: string;
      dependencies?: Array<{ table: string; label: string; count: number }>;
    }>;
    errors: string[];
    message: string;
  } | null>(null);
  const [isBulkUpdatingStatus, setIsBulkUpdatingStatus] = useState<boolean>(false);

  // Single Delete Confirmation State
  const [singleDeleteCandidate, setSingleDeleteCandidate] = useState<Business | null>(null);

  // Add / Edit Business Modal State
  const [isFormModalOpen, setIsFormModalOpen] = useState<boolean>(false);
  const [editingBiz, setEditingBiz] = useState<Business | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [formData, setFormData] = useState({
    name: '',
    tradeName: '',
    gstin: '',
    pan: '',
    email: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    stateCode: '',
    pincode: '',
    currency: 'INR',
    financialYearStart: '04-01',
    status: 'ACTIVE',
    businessType: 'MAIN' as 'MAIN' | 'DEALER',
    parentBusinessId: '' as string,
  });

  // Manage Users Drawer/Modal
  const [userModalBiz, setUserModalBiz] = useState<Business | null>(null);
  const [bizUsers, setBizUsers] = useState<BusinessUserRecord[]>([]);
  const [loadingBizUsers, setLoadingBizUsers] = useState<boolean>(false);
  const [selectedNewUserId, setSelectedNewUserId] = useState<string>('');
  const [selectedNewUserRoleId, setSelectedNewUserRoleId] = useState<string>('');
  const [isAssigningUser, setIsAssigningUser] = useState<boolean>(false);

  // Deletion / Dependency State
  const [deleteTargetBiz, setDeleteTargetBiz] = useState<Business | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteBlockedError, setDeleteBlockedError] = useState<{
    message: string;
    dependencies: Array<{ table: string; label: string; count: number }>;
  } | null>(null);

  const isSuperAdmin = Boolean(currentUser?.isSuperAdmin);

  const fetchBusinessesAndData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [bizData, rolesData, usersData] = await Promise.all([
        apiRequest('/api/businesses'),
        apiRequest('/api/roles').catch(() => []),
        apiRequest('/api/users').catch(() => []),
      ]);
      setBusinessesList(bizData);
      setAllRoles(rolesData);
      setAllUsers(usersData);
    } catch (err: any) {
      setError(err.message || 'Failed to load businesses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBusinessesAndData();
  }, []);

  const openCreateModal = () => {
    setEditingBiz(null);
    setFormData({
      name: '',
      tradeName: '',
      gstin: '',
      pan: '',
      email: '',
      phone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      stateCode: '',
      pincode: '',
      currency: 'INR',
      financialYearStart: '04-01',
      status: 'ACTIVE',
      businessType: 'MAIN',
      parentBusinessId: '',
    });
    setError(null);
    setSuccessMsg(null);
    setIsFormModalOpen(true);
  };

  const openEditModal = (biz: Business) => {
    setEditingBiz(biz);
    setFormData({
      name: biz.name || '',
      tradeName: biz.tradeName || '',
      gstin: biz.gstin || '',
      pan: biz.pan || '',
      email: biz.email || '',
      phone: biz.phone || '',
      addressLine1: biz.addressLine1 || '',
      addressLine2: biz.addressLine2 || '',
      city: biz.city || '',
      state: biz.state || '',
      stateCode: biz.stateCode || '',
      pincode: biz.pincode || '',
      currency: biz.currency || 'INR',
      financialYearStart: biz.financialYearStart || '04-01',
      status: biz.status || 'ACTIVE',
      businessType: (biz.businessType as 'MAIN' | 'DEALER') || 'MAIN',
      parentBusinessId: biz.parentBusinessId || '',
    });
    setError(null);
    setSuccessMsg(null);
    setIsFormModalOpen(true);
  };

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Business Name is required.');
      return;
    }

    if (formData.businessType === 'DEALER' && !formData.parentBusinessId) {
      setError('Please select a Parent Main Warehouse for this Dealer business.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        ...formData,
        parentBusinessId: formData.businessType === 'DEALER' ? (formData.parentBusinessId || null) : null,
      };

      if (editingBiz) {
        await apiRequest(`/api/businesses/${editingBiz.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setSuccessMsg(`Business '${formData.name}' updated successfully.`);
      } else {
        await apiRequest('/api/businesses', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSuccessMsg(`Business '${formData.name}' created with standard settings initialized.`);
      }
      setIsFormModalOpen(false);
      await fetchBusinessesAndData();
    } catch (err: any) {
      setError(err.message || 'Failed to save business');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (biz: Business) => {
    const isActivating = biz.status !== 'ACTIVE';
    const endpoint = isActivating ? `/api/businesses/${biz.id}/activate` : `/api/businesses/${biz.id}/deactivate`;
    try {
      const res = await apiRequest(endpoint, { method: 'POST' });
      setSuccessMsg(
        isActivating
          ? `Business '${biz.name}' activated successfully.`
          : res.message || `Business '${biz.name}' deactivated successfully.`
      );
      await fetchBusinessesAndData();
    } catch (err: any) {
      setError(err.message || `Failed to ${isActivating ? 'activate' : 'deactivate'} business`);
    }
  };

  const openUsersModal = async (biz: Business) => {
    setUserModalBiz(biz);
    setLoadingBizUsers(true);
    setSelectedNewUserId('');
    setSelectedNewUserRoleId(allRoles[0]?.id || '');
    try {
      const usersData = await apiRequest(`/api/businesses/${biz.id}/users`);
      setBizUsers(usersData);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch business users');
    } finally {
      setLoadingBizUsers(false);
    }
  };

  const handleAssignUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userModalBiz || !selectedNewUserId || !selectedNewUserRoleId) {
      setError('Please select a user and a role.');
      return;
    }

    setIsAssigningUser(true);
    try {
      await apiRequest(`/api/businesses/${userModalBiz.id}/users`, {
        method: 'POST',
        body: JSON.stringify({
          userId: selectedNewUserId,
          roleId: selectedNewUserRoleId,
        }),
      });
      setSuccessMsg('User successfully assigned to business.');
      setSelectedNewUserId('');
      const updatedUsers = await apiRequest(`/api/businesses/${userModalBiz.id}/users`);
      setBizUsers(updatedUsers);
      await fetchBusinessesAndData();
    } catch (err: any) {
      setError(err.message || 'Failed to assign user');
    } finally {
      setIsAssigningUser(false);
    }
  };

  const handleUpdateUserRole = async (userId: string, newRoleId: string) => {
    if (!userModalBiz) return;
    try {
      await apiRequest(`/api/businesses/${userModalBiz.id}/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ roleId: newRoleId }),
      });
      setSuccessMsg('User role updated for this business.');
      const updatedUsers = await apiRequest(`/api/businesses/${userModalBiz.id}/users`);
      setBizUsers(updatedUsers);
    } catch (err: any) {
      setError(err.message || 'Failed to update user role');
    }
  };

  const handleRemoveUserAccess = async (userId: string, username: string) => {
    if (!userModalBiz) return;
    if (!window.confirm(`Are you sure you want to revoke '${username}' access from ${userModalBiz.name}?`)) {
      return;
    }
    try {
      await apiRequest(`/api/businesses/${userModalBiz.id}/users/${userId}`, {
        method: 'DELETE',
      });
      setSuccessMsg(`Access for '${username}' removed from ${userModalBiz.name}.`);
      const updatedUsers = await apiRequest(`/api/businesses/${userModalBiz.id}/users`);
      setBizUsers(updatedUsers);
      await fetchBusinessesAndData();
    } catch (err: any) {
      setError(err.message || 'Failed to remove user access');
    }
  };

  const filteredBusinesses = businessesList.filter(b => {
    const matchesSearch =
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      (b.tradeName && b.tradeName.toLowerCase().includes(search.toLowerCase())) ||
      (b.gstin && b.gstin.toLowerCase().includes(search.toLowerCase())) ||
      (b.city && b.city.toLowerCase().includes(search.toLowerCase())) ||
      (b.state && b.state.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus =
      statusFilter === 'ALL'
        ? true
        : statusFilter === 'ACTIVE'
        ? b.status === 'ACTIVE'
        : b.status !== 'ACTIVE';

    return matchesSearch && matchesStatus;
  });

  // Selectable businesses on the current view (cannot select currently logged-in business)
  const selectableFilteredBusinesses = filteredBusinesses.filter(b => b.id !== currentBusiness?.id);

  const allVisibleSelected =
    selectableFilteredBusinesses.length > 0 &&
    selectableFilteredBusinesses.every(b => selectedBizIds.has(b.id));

  const someVisibleSelected =
    selectableFilteredBusinesses.some(b => selectedBizIds.has(b.id));

  const isIndeterminate = someVisibleSelected && !allVisibleSelected;

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedBizIds(prev => {
        const next = new Set(prev);
        selectableFilteredBusinesses.forEach(b => next.delete(b.id));
        return next;
      });
    } else {
      setSelectedBizIds(prev => {
        const next = new Set(prev);
        selectableFilteredBusinesses.forEach(b => next.add(b.id));
        return next;
      });
    }
  };

  const handleToggleSelectBusiness = (bizId: string) => {
    if (bizId === currentBusiness?.id) return;
    setSelectedBizIds(prev => {
      const next = new Set(prev);
      if (next.has(bizId)) next.delete(bizId);
      else next.add(bizId);
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedBizIds(new Set());
  };

  // Open Bulk Delete Modal
  const handleOpenBulkDelete = () => {
    if (selectedBizIds.size === 0) return;
    setBulkDeleteResult(null);
    setShowBulkDeleteModal(true);
  };

  // Confirm Bulk Delete
  const handleConfirmBulkDelete = async () => {
    const ids = Array.from(selectedBizIds);
    if (ids.length === 0) return;

    setIsBulkDeleting(true);
    try {
      const res = await apiRequest<{
        success: boolean;
        totalRequested: number;
        deletedCount: number;
        failedCount: number;
        deletedIds: string[];
        blockedBusinesses: Array<{
          id: string;
          name: string;
          reason: string;
          dependencies?: Array<{ table: string; label: string; count: number }>;
        }>;
        errors: string[];
        message: string;
      }>('/api/businesses/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });

      setBulkDeleteResult(res);

      if (res.deletedCount > 0) {
        const deletedSet = new Set(res.deletedIds);
        setBusinessesList(prev => prev.filter(b => !deletedSet.has(b.id)));
        setSelectedBizIds(prev => {
          const next = new Set(prev);
          res.deletedIds.forEach(id => next.delete(id));
          return next;
        });
        await fetchBusinessesAndData();
        await refreshUser();
      }

      if (res.failedCount === 0) {
        setSuccessMsg(res.message || `Successfully deleted ${res.deletedCount} business(es).`);
        setShowBulkDeleteModal(false);
        setBulkDeleteResult(null);
        setSelectedBizIds(new Set());
      }
    } catch (err: any) {
      setError(err.message || 'Failed to bulk delete businesses');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // Bulk Deactivate Action
  const handleBulkDeactivate = async () => {
    const ids = Array.from(selectedBizIds);
    if (ids.length === 0) return;

    if (!window.confirm(`Are you sure you want to deactivate ${ids.length} selected business(es)? Users will have their access paused.`)) {
      return;
    }

    setIsBulkUpdatingStatus(true);
    try {
      const res = await apiRequest<{ success: boolean; updatedCount: number; message: string }>(
        '/api/businesses/bulk-status',
        {
          method: 'POST',
          body: JSON.stringify({ ids, status: 'INACTIVE' }),
        }
      );
      setSuccessMsg(res.message || `Successfully deactivated ${res.updatedCount} business(es).`);
      setSelectedBizIds(new Set());
      await fetchBusinessesAndData();
      await refreshUser();
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate businesses');
    } finally {
      setIsBulkUpdatingStatus(false);
    }
  };

  // Deactivate Blocked Businesses from Bulk Deletion Result
  const handleDeactivateBlockedBusinesses = async (blockedIds: string[]) => {
    if (!blockedIds.length) return;
    setIsBulkUpdatingStatus(true);
    try {
      const res = await apiRequest<{ success: boolean; updatedCount: number; message: string }>(
        '/api/businesses/bulk-status',
        {
          method: 'POST',
          body: JSON.stringify({ ids: blockedIds, status: 'INACTIVE' }),
        }
      );
      setSuccessMsg(`Deactivated ${res.updatedCount} blocked business(es) successfully.`);
      setShowBulkDeleteModal(false);
      setBulkDeleteResult(null);
      setSelectedBizIds(new Set());
      await fetchBusinessesAndData();
      await refreshUser();
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate blocked businesses');
    } finally {
      setIsBulkUpdatingStatus(false);
    }
  };

  // Confirm Single Delete
  const handleConfirmSingleDelete = async () => {
    if (!singleDeleteCandidate) return;
    const biz = singleDeleteCandidate;
    setDeleteTargetBiz(biz);
    setDeleteBlockedError(null);
    setIsDeleting(true);
    try {
      await apiRequest(`/api/businesses/${biz.id}`, { method: 'DELETE' });
      setSuccessMsg(`Business '${biz.name}' permanently deleted.`);
      setSingleDeleteCandidate(null);
      setDeleteTargetBiz(null);
      setBusinessesList(prev => prev.filter(b => b.id !== biz.id));
      setSelectedBizIds(prev => {
        const next = new Set(prev);
        next.delete(biz.id);
        return next;
      });
      await fetchBusinessesAndData();
      await refreshUser();
    } catch (err: any) {
      setSingleDeleteCandidate(null);
      if (err.dependencies && Array.isArray(err.dependencies)) {
        setDeleteBlockedError({
          message: err.message || err.error || 'Deletion blocked due to existing operational records.',
          dependencies: err.dependencies,
        });
      } else {
        setError(err.message || 'Failed to delete business');
        setDeleteTargetBiz(null);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const activeCount = businessesList.filter(b => b.status === 'ACTIVE').length;
  const inactiveCount = businessesList.filter(b => b.status !== 'ACTIVE').length;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-blue-600" />
            <span>Business Entities & Multi-Tenancy</span>
          </h2>
          <p className="text-xs text-slate-500">
            Manage company profiles, legal registrations, active status, user memberships, and tenant settings
          </p>
        </div>

        {isSuperAdmin && (
          <button
            id="btn-add-business"
            onClick={openCreateModal}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-md shadow-blue-600/20 transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Business</span>
          </button>
        )}
      </div>

      {/* Metric Cards Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs text-slate-500 font-medium">Total Registered Businesses</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{businessesList.length}</div>
          <div className="text-[11px] text-slate-400 mt-1">Multi-tenant instances configured</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs text-emerald-600 font-medium flex items-center gap-1.5">
            <BadgeCheck className="w-3.5 h-3.5" />
            <span>Active Businesses</span>
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{activeCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">Operational with live transaction support</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs text-amber-600 font-medium flex items-center gap-1.5">
            <PowerOff className="w-3.5 h-3.5" />
            <span>Inactive / Suspended</span>
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{inactiveCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">Archived or paused access</div>
        </div>
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold text-sm">✕</button>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-800 font-bold text-sm">✕</button>
        </div>
      )}

      {/* Floating Selection Bar for Multi-Delete and Status */}
      {selectedBizIds.size > 0 && isSuperAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs animate-in slide-in-from-top-1">
          <div className="flex items-center gap-2.5 text-xs text-amber-900 font-medium">
            <span className="px-2.5 py-0.5 bg-amber-200 rounded-full font-bold font-mono text-amber-950">
              {selectedBizIds.size}
            </span>
            <span>business entity/entities selected for administrative action</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleClearSelection}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-xl hover:bg-amber-100 transition-colors cursor-pointer"
            >
              Clear Selection
            </button>

            <button
              type="button"
              onClick={handleBulkDeactivate}
              disabled={isBulkUpdatingStatus}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              title="Deactivate all selected businesses"
            >
              <PowerOff className="w-3.5 h-3.5" />
              <span>Deactivate Selected</span>
            </button>

            <button
              type="button"
              id="btn-bulk-delete-businesses"
              onClick={handleOpenBulkDelete}
              disabled={isBulkDeleting}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              title="Delete all selected businesses"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Selected ({selectedBizIds.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by business name, trade name, GSTIN, city..."
              className="w-full pl-9 pr-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
          </div>

          {/* Filters & Refresh */}
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-100 p-0.5 rounded-xl text-xs">
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === 'ALL' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({businessesList.length})
              </button>
              <button
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === 'ACTIVE' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Active ({activeCount})
              </button>
              <button
                onClick={() => setStatusFilter('INACTIVE')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === 'INACTIVE' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Inactive ({inactiveCount})
              </button>
            </div>

            <button
              onClick={fetchBusinessesAndData}
              disabled={loading}
              className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600"
              title="Refresh Businesses"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Businesses Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/80 text-slate-700 border-b border-slate-100 uppercase tracking-wider text-[10px] font-semibold">
              <tr>
                {isSuperAdmin && (
                  <th className="px-4 py-3.5 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={input => {
                        if (input) input.indeterminate = isIndeterminate;
                      }}
                      onChange={handleToggleSelectAll}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer"
                      title="Select all deletable businesses on this view"
                    />
                  </th>
                )}
                <th className="px-5 py-3.5">Business Name & Trade Name</th>
                <th className="px-5 py-3.5">Type & Hierarchy</th>
                <th className="px-5 py-3.5">Tax / GSTIN / PAN</th>
                <th className="px-5 py-3.5">Location & Contact</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Assigned Users</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={isSuperAdmin ? 8 : 7} className="px-5 py-8 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Loading businesses from PostgreSQL...
                  </td>
                </tr>
              ) : filteredBusinesses.length === 0 ? (
                <tr>
                  <td colSpan={isSuperAdmin ? 8 : 7} className="px-5 py-8 text-center text-slate-400">
                    No businesses found matching your filter criteria.
                  </td>
                </tr>
              ) : (
                filteredBusinesses.map((b) => {
                  const isCurrent = currentBusiness?.id === b.id;
                  const isActive = b.status === 'ACTIVE';
                  const isDealer = b.businessType === 'DEALER';
                  const isSelected = selectedBizIds.has(b.id);

                  return (
                    <tr key={b.id} className={`hover:bg-slate-50/60 transition-colors ${isSelected ? 'bg-blue-50/40' : ''}`}>
                      {/* Selection Checkbox */}
                      {isSuperAdmin && (
                        <td className="px-4 py-3.5 text-center">
                          {isCurrent ? (
                            <span title="Currently logged in business cannot be deleted">
                              <input
                                type="checkbox"
                                disabled
                                className="rounded border-slate-200 text-slate-300 h-3.5 w-3.5 cursor-not-allowed opacity-30"
                              />
                            </span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelectBusiness(b.id)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer"
                              title={`Select '${b.name}'`}
                            />
                          )}
                        </td>
                      )}

                      {/* Name & Trade Name */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-start gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                            isDealer ? 'bg-purple-50 text-purple-700 border border-purple-100' :
                            isActive ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {b.name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                              <span>{b.name}</span>
                              {isCurrent && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">
                                  Current
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500">{b.tradeName || 'No Trade Name'}</div>
                          </div>
                        </div>
                      </td>

                      {/* Type & Hierarchy */}
                      <td className="px-5 py-3.5">
                        {isDealer ? (
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                              DEALER
                            </span>
                            <div className="text-[10px] text-slate-500 flex items-center gap-1">
                              <span>Warehouse:</span>
                              <span className="font-medium text-slate-700">{b.parentBusinessName || 'Unassigned'}</span>
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                            MAIN WAREHOUSE
                          </span>
                        )}
                      </td>

                      {/* Tax & Identifiers */}
                      <td className="px-5 py-3.5">
                        <div className="space-y-0.5">
                          <div className="font-mono text-[11px] text-slate-900 font-medium">
                            {b.gstin ? b.gstin : <span className="text-slate-400 italic">No GSTIN</span>}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            PAN: {b.pan || '—'}
                          </div>
                        </div>
                      </td>

                      {/* Location & Contact */}
                      <td className="px-5 py-3.5">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1 text-slate-700">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{[b.city, b.state].filter(Boolean).join(', ') || 'Address not specified'}</span>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {[b.phone, b.email].filter(Boolean).join(' • ') || '—'}
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                            isActive
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                          {b.status}
                        </span>
                      </td>

                      {/* Assigned Users */}
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => openUsersModal(b)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition-colors"
                          title="View and manage users assigned to this business"
                        >
                          <Users className="w-3.5 h-3.5 text-blue-600" />
                          <span>{b.userCount ?? 0} Users</span>
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditModal(b)}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600"
                            title="Edit Business Profile"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => openUsersModal(b)}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-blue-600"
                            title="Manage Business Users"
                          >
                            <Users className="w-3.5 h-3.5" />
                          </button>

                          {isSuperAdmin && (
                            <>
                              <button
                                onClick={() => handleToggleStatus(b)}
                                className={`p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 ${
                                  isActive ? 'text-amber-600 hover:text-amber-700' : 'text-emerald-600 hover:text-emerald-700'
                                }`}
                                title={isActive ? 'Deactivate Business' : 'Activate Business'}
                              >
                                {isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                              </button>

                              <button
                                onClick={() => setSingleDeleteCandidate(b)}
                                className="p-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-600 cursor-pointer"
                                title="Delete Business (with safety checks)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
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

      {/* MODAL 1: Create / Edit Business */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Building2 className="w-4 h-4 text-blue-600" />
                <span>{editingBiz ? 'Edit Business Profile' : 'Create New Business Entity'}</span>
              </div>
              <button
                onClick={() => setIsFormModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBusiness} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Business Role & Hierarchy */}
                <div className="sm:col-span-2 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="font-semibold text-slate-800 text-xs flex items-center justify-between">
                    <span>Business Role & Hierarchy</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      formData.businessType === 'DEALER' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {formData.businessType === 'DEALER' ? 'Dealer Entity' : 'Main Warehouse'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">
                        Business Type <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formData.businessType}
                        onChange={(e) => setFormData({
                          ...formData,
                          businessType: e.target.value as 'MAIN' | 'DEALER',
                          parentBusinessId: e.target.value === 'MAIN' ? '' : formData.parentBusinessId,
                        })}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 font-medium text-slate-800"
                      >
                        <option value="MAIN">Main Warehouse (HQ / Primary Inventory)</option>
                        <option value="DEALER">Dealer (Retailer / Franchise with Parent Warehouse feed)</option>
                      </select>
                    </div>

                    {formData.businessType === 'DEALER' ? (
                      <div>
                        <label className="block text-purple-900 font-medium mb-1">
                          Designated Parent Main Warehouse <span className="text-red-500">*</span>
                        </label>
                        <select
                          required
                          value={formData.parentBusinessId}
                          onChange={(e) => setFormData({ ...formData, parentBusinessId: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-purple-300 rounded-xl focus:ring-2 focus:ring-purple-500 font-medium text-slate-800"
                        >
                          <option value="">-- Select Main Warehouse --</option>
                          {businessesList
                            .filter((b) => b.businessType !== 'DEALER' && (!editingBiz || b.id !== editingBiz.id))
                            .map((mainBiz) => (
                              <option key={mainBiz.id} value={mainBiz.id}>
                                {mainBiz.name} ({mainBiz.city || 'No City'})
                              </option>
                            ))}
                        </select>
                      </div>
                    ) : (
                      <div className="flex items-center text-[11px] text-slate-500 pt-5">
                        <span>Provides central catalog & real-time stock feed to registered dealers.</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-slate-700 font-medium mb-1">
                    Legal Business Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Lumina Opticals Pvt Ltd"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Trade / Brand Name</label>
                  <input
                    type="text"
                    value={formData.tradeName}
                    onChange={(e) => setFormData({ ...formData, tradeName: e.target.value })}
                    placeholder="e.g. Lumina Vision Studio"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">GSTIN (15 characters)</label>
                  <input
                    type="text"
                    maxLength={15}
                    value={formData.gstin}
                    onChange={(e) => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
                    placeholder="e.g. 27AAAAA0000A1Z5"
                    className="w-full font-mono uppercase px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">PAN (10 characters)</label>
                  <input
                    type="text"
                    maxLength={10}
                    value={formData.pan}
                    onChange={(e) => setFormData({ ...formData, pan: e.target.value.toUpperCase() })}
                    placeholder="e.g. ABCDE1234F"
                    className="w-full font-mono uppercase px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="e.g. +91 9876543210"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-slate-700 font-medium mb-1">Official Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="billing@luminaoptical.com"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-slate-700 font-medium mb-1">Address Line 1</label>
                  <input
                    type="text"
                    value={formData.addressLine1}
                    onChange={(e) => setFormData({ ...formData, addressLine1: e.target.value })}
                    placeholder="Shop #12, Optical Hub Complex"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-slate-700 font-medium mb-1">Address Line 2</label>
                  <input
                    type="text"
                    value={formData.addressLine2}
                    onChange={(e) => setFormData({ ...formData, addressLine2: e.target.value })}
                    placeholder="MG Road, Commercial Area"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">City</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    placeholder="Mumbai"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">State & State Code</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={formData.state}
                      onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                      placeholder="Maharashtra"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                    />
                    <input
                      type="text"
                      maxLength={2}
                      value={formData.stateCode}
                      onChange={(e) => setFormData({ ...formData, stateCode: e.target.value })}
                      placeholder="27"
                      className="w-full font-mono px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Pincode</label>
                  <input
                    type="text"
                    maxLength={10}
                    value={formData.pincode}
                    onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                    placeholder="400001"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Financial Year Start</label>
                  <input
                    type="text"
                    value={formData.financialYearStart}
                    onChange={(e) => setFormData({ ...formData, financialYearStart: e.target.value })}
                    placeholder="04-01"
                    className="w-full font-mono px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md shadow-blue-600/20 disabled:opacity-50 flex items-center gap-2"
                >
                  {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingBiz ? 'Update Business' : 'Create Business Entity'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Manage Business Users Drawer */}
      {userModalBiz && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                  <Users className="w-4 h-4 text-blue-600" />
                  <span>Users Assigned to: {userModalBiz.name}</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Configure role assignments and business permissions for this tenant
                </div>
              </div>
              <button
                onClick={() => setUserModalBiz(null)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto flex-1 text-xs">
              {/* Assign New User to this Business Form */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="font-semibold text-slate-900 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-blue-600" />
                  <span>Assign User to this Business</span>
                </div>
                <form onSubmit={handleAssignUser} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1">Select User</label>
                    <select
                      value={selectedNewUserId}
                      onChange={(e) => setSelectedNewUserId(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                    >
                      <option value="">-- Choose User --</option>
                      {allUsers
                        .filter(u => !bizUsers.some(bu => bu.id === u.id))
                        .map(u => (
                          <option key={u.id} value={u.id}>
                            {u.fullName} ({u.username})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1">Role for this Business</label>
                    <select
                      value={selectedNewUserRoleId}
                      onChange={(e) => setSelectedNewUserRoleId(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                    >
                      {allRoles.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={isAssigningUser || !selectedNewUserId}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-xs disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {isAssigningUser && <RefreshCw className="w-3 h-3 animate-spin" />}
                    <span>Assign Access</span>
                  </button>
                </form>
              </div>

              {/* Existing Users Table */}
              <div className="space-y-2">
                <div className="font-semibold text-slate-900 flex items-center justify-between">
                  <span>Currently Authorized Users ({bizUsers.length})</span>
                  {loadingBizUsers && <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />}
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50 text-slate-700 text-[10px] uppercase font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-3.5 py-2">User</th>
                        <th className="px-3.5 py-2">Role in Business</th>
                        <th className="px-3.5 py-2">Default</th>
                        <th className="px-3.5 py-2 text-right">Revoke</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {bizUsers.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3.5 py-6 text-center text-slate-400">
                            No users assigned to this business yet.
                          </td>
                        </tr>
                      ) : (
                        bizUsers.map(u => (
                          <tr key={u.id} className="hover:bg-slate-50/60">
                            <td className="px-3.5 py-2.5">
                              <div className="font-medium text-slate-900">{u.fullName}</div>
                              <div className="text-[10px] text-slate-400">@{u.username}</div>
                            </td>

                            <td className="px-3.5 py-2.5">
                              <select
                                value={u.roleId || ''}
                                onChange={(e) => handleUpdateUserRole(u.id, e.target.value)}
                                className="px-2 py-1 bg-white border border-slate-200 rounded text-[11px]"
                              >
                                {allRoles.map(r => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="px-3.5 py-2.5">
                              {u.isDefault ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                                  Default
                                </span>
                              ) : (
                                <span className="text-slate-300 text-[11px]">—</span>
                              )}
                            </td>

                            <td className="px-3.5 py-2.5 text-right">
                              <button
                                onClick={() => handleRemoveUserAccess(u.id, u.username)}
                                className="p-1 rounded text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors"
                                title="Revoke access to this business"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => setUserModalBiz(null)}
                className="px-4 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Single Delete Confirmation */}
      {singleDeleteCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-start gap-3 text-red-600">
              <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">Delete Business Entity</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Are you sure you want to permanently delete this business?
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-500">Business Name:</span>
                <span className="font-bold text-slate-900">{singleDeleteCandidate.name}</span>
              </div>
              {singleDeleteCandidate.tradeName && (
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-500">Trade Name:</span>
                  <span className="text-slate-700">{singleDeleteCandidate.tradeName}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-500">Entity Type:</span>
                <span className="font-medium text-slate-700">
                  {singleDeleteCandidate.businessType === 'DEALER' ? 'Dealer Branch' : 'Main Warehouse'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-500">Status:</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200 text-slate-700">
                  {singleDeleteCandidate.status}
                </span>
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800">
              <strong>ERP Safety Verification:</strong> Permanent deletion will only proceed if the business has zero accounting journals, stock batches, invoices, or customer ledgers.
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSingleDeleteCandidate(null)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSingleDelete}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium text-xs shadow-md shadow-red-600/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Verifying & Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Bulk Delete Confirmation & Results */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-red-600">
                <Trash2 className="w-5 h-5" />
                <h3 className="font-bold text-sm text-slate-900">
                  Bulk Delete Businesses ({selectedBizIds.size} Selected)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowBulkDeleteModal(false);
                  setBulkDeleteResult(null);
                }}
                disabled={isBulkDeleting}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto text-xs">
              {!bulkDeleteResult ? (
                <>
                  <p className="text-slate-600">
                    You have selected <strong className="text-slate-900 font-mono">{selectedBizIds.size}</strong> business entities for deletion:
                  </p>

                  <div className="max-h-52 overflow-y-auto space-y-1.5 border border-slate-200 rounded-xl p-2.5 bg-slate-50">
                    {businessesList
                      .filter(b => selectedBizIds.has(b.id))
                      .map(b => (
                        <div
                          key={b.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-slate-900">{b.name}</div>
                            <div className="text-[10px] text-slate-500">
                              {b.businessType === 'DEALER' ? 'Dealer Branch' : 'Main Warehouse'} • {b.city || 'No city'}
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            b.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                          }`}>
                            {b.status}
                          </span>
                        </div>
                      ))}
                  </div>

                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                      <span>ERP Multi-Tenant Safeguards</span>
                    </div>
                    <p>
                      Each business will be automatically analyzed before deletion. Any business containing accounting records, inventory stock, sales invoices, or purchase ledgers will be protected from deletion. Clean/unused businesses will be permanently deleted.
                    </p>
                  </div>
                </>
              ) : (
                /* Results Display */
                <div className="space-y-3 animate-in fade-in">
                  <div
                    className={`p-3.5 rounded-xl border font-semibold flex items-center gap-2 ${
                      bulkDeleteResult.failedCount === 0
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}
                  >
                    {bulkDeleteResult.failedCount === 0 ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    )}
                    <span>{bulkDeleteResult.message}</span>
                  </div>

                  {bulkDeleteResult.deletedCount > 0 && (
                    <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 space-y-1">
                      <div className="text-[11px] font-bold text-emerald-800">
                        Permanently Deleted ({bulkDeleteResult.deletedCount}):
                      </div>
                      <div className="text-[11px] text-emerald-700">
                        {bulkDeleteResult.deletedIds.length} business entity/entities removed completely.
                      </div>
                    </div>
                  )}

                  {bulkDeleteResult.blockedBusinesses && bulkDeleteResult.blockedBusinesses.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-bold text-red-800 flex items-center justify-between">
                        <span>Blocked from Deletion ({bulkDeleteResult.blockedBusinesses.length}):</span>
                        <span className="text-[10px] text-slate-500 font-normal">Records detected</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-2">
                        {bulkDeleteResult.blockedBusinesses.map(b => (
                          <div key={b.id} className="p-3 rounded-xl bg-red-50 border border-red-200 space-y-1.5">
                            <div className="flex justify-between items-center font-bold text-slate-900">
                              <span>{b.name}</span>
                              <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                                Protected
                              </span>
                            </div>
                            <p className="text-[11px] text-red-700">{b.reason}</p>
                            {b.dependencies && b.dependencies.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {b.dependencies.map(dep => (
                                  <span
                                    key={dep.table}
                                    className="px-2 py-0.5 rounded-md bg-white border border-red-200 text-[10px] text-slate-700 font-medium"
                                  >
                                    {dep.label}: <strong className="font-mono text-red-700">{dep.count}</strong>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleDeactivateBlockedBusinesses(
                              bulkDeleteResult.blockedBusinesses.map(b => b.id)
                            )
                          }
                          disabled={isBulkUpdatingStatus}
                          className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-medium text-xs shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <PowerOff className="w-3.5 h-3.5" />
                          <span>Deactivate All {bulkDeleteResult.blockedBusinesses.length} Blocked Businesses Instead</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowBulkDeleteModal(false);
                  setBulkDeleteResult(null);
                }}
                disabled={isBulkDeleting}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-white text-xs font-medium cursor-pointer"
              >
                {bulkDeleteResult ? 'Close' : 'Cancel'}
              </button>

              {!bulkDeleteResult && (
                <button
                  type="button"
                  onClick={handleConfirmBulkDelete}
                  disabled={isBulkDeleting}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium text-xs shadow-md shadow-red-600/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isBulkDeleting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting {selectedBizIds.size} Businesses...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete {selectedBizIds.size} Selected Businesses</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Delete Blocked / Safety Dependency Report */}
      {deleteBlockedError && deleteTargetBiz && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-start gap-3 text-red-600">
              <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">Permanent Deletion Blocked</h3>
                <p className="text-xs text-slate-600 mt-1">
                  {deleteBlockedError.message}
                </p>
              </div>
            </div>

            <div className="p-3 bg-red-50 rounded-xl border border-red-100 space-y-1.5 text-xs">
              <div className="font-semibold text-red-800">Operational Records Detected:</div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                {deleteBlockedError.dependencies.map(dep => (
                  <div key={dep.table} className="flex items-center justify-between bg-white/80 px-2 py-1 rounded border border-red-200 text-slate-700">
                    <span>{dep.label}</span>
                    <span className="font-bold text-red-700 font-mono">{dep.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-[11px] text-slate-500">
              Under Indian GST, tax audit and ERP integrity rules, businesses with posted invoices, ledger journals, or inventory batches cannot be deleted. You can safely deactivate this business instead to prevent any future transactions.
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => {
                  setDeleteBlockedError(null);
                  setDeleteTargetBiz(null);
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const target = deleteTargetBiz;
                  setDeleteBlockedError(null);
                  setDeleteTargetBiz(null);
                  await handleToggleStatus(target);
                }}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs shadow-md shadow-amber-600/20 flex items-center gap-1.5"
              >
                <PowerOff className="w-3.5 h-3.5" />
                <span>Deactivate Business Instead</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BusinessesPage;
