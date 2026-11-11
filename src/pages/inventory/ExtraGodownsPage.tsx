import React, { useState, useEffect } from 'react';
import {
  Building2,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Users,
  Shield,
  Key,
  Edit2,
  Lock,
  Boxes,
  Eye,
  RefreshCw,
  AlertTriangle,
  X,
  Store,
  ChevronRight,
  UserPlus,
  Check,
  Building,
  ArrowRightLeft,
  History,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { Godown, B2bOrderSyncLog } from '../../types/index.js';

interface GodownStockBalance {
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

interface GodownUser {
  id: string;
  username: string;
  fullName: string;
  email?: string | null;
  mobile?: string | null;
  status: string;
  roles?: Array<{ id: string; name: string; code: string }>;
  userPermissionsOverride?: Record<string, boolean>;
  createdAt: string;
  lastLoginAt?: string | null;
}

export const ExtraGodownsPage: React.FC = () => {
  const { currentBusiness, hasPermission } = useAuth();
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'godowns' | 'consolidated_stock' | 'sync_logs'>('godowns');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingGodown, setEditingGodown] = useState<Godown | null>(null);
  const [selectedGodownForUsers, setSelectedGodownForUsers] = useState<Godown | null>(null);
  const [selectedGodownForStock, setSelectedGodownForStock] = useState<Godown | null>(null);

  // Godown Form State
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formType, setFormType] = useState<'SECONDARY_WAREHOUSE' | 'DEALER_GODOWN'>('SECONDARY_WAREHOUSE');
  const [formAddress, setFormAddress] = useState('');
  const [formContactPerson, setFormContactPerson] = useState('');
  const [formMobile, setFormMobile] = useState('');
  const [formDealerPartyId, setFormDealerPartyId] = useState('');
  const [formStatus, setFormStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  // B2B Order Synchronization
  const [formEnableB2bOrderSync, setFormEnableB2bOrderSync] = useState(false);
  const [formSyncDirectInvoice, setFormSyncDirectInvoice] = useState(false);
  const [formDefaultProcessingPreference, setFormDefaultProcessingPreference] = useState<'AUTO_ACCEPT' | 'REQUIRES_ACCEPTANCE'>('REQUIRES_ACCEPTANCE');
  const [formSyncStatus, setFormSyncStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  const [dealerParties, setDealerParties] = useState<Array<{ id: string; name: string; partyCode?: string }>>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // B2B Sync Logs State
  const [syncLogs, setSyncLogs] = useState<B2bOrderSyncLog[]>([]);
  const [loadingSyncLogs, setLoadingSyncLogs] = useState(false);
  const [syncLogsSearch, setSyncLogsSearch] = useState('');
  const [retryingLogId, setRetryingLogId] = useState<string | null>(null);
  const [syncLogsFilter, setSyncLogsFilter] = useState<'ALL' | 'SYNCED' | 'FAILED' | 'CONFLICT'>('ALL');

  // Staff Management State
  const [godownUsers, setGodownUsers] = useState<GodownUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newMobile, setNewMobile] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [userError, setUserError] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState(false);

  // Stock Balances State
  const [stockBalances, setStockBalances] = useState<GodownStockBalance[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [stockSearchQuery, setStockSearchQuery] = useState('');

  // Consolidated Stock State
  const [consolidatedGodownId, setConsolidatedGodownId] = useState<string>('all');
  const [consolidatedStocks, setConsolidatedStocks] = useState<any[]>([]);
  const [loadingConsolidated, setLoadingConsolidated] = useState(false);

  // Fetch Godowns
  const fetchGodowns = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/godowns', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.godowns || data.items || []);
        setGodowns(list);
      }
    } catch (err) {
      console.error('Failed to load godowns', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch dealer parties for optional link
  const fetchDealerParties = async () => {
    try {
      const res = await fetch('/api/parties?partyType=DEALER&limit=100', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setDealerParties(data.parties || []);
      }
    } catch (err) {
      console.error('Failed to load dealer parties', err);
    }
  };

  // Fetch B2B Sync Logs
  const fetchSyncLogs = async () => {
    setLoadingSyncLogs(true);
    try {
      const res = await fetch('/api/godowns/b2b-sync/logs?limit=100', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setSyncLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to load B2B sync logs', err);
    } finally {
      setLoadingSyncLogs(false);
    }
  };

  // Retry a failed B2B sync
  const handleRetrySync = async (logId: string) => {
    setRetryingLogId(logId);
    try {
      const res = await fetch(`/api/godowns/b2b-sync/logs/${logId}/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || 'Retry failed');
      } else {
        await fetchSyncLogs();
        await fetchGodowns();
      }
    } catch (err: any) {
      alert(err.message || 'Network error during retry');
    } finally {
      setRetryingLogId(null);
    }
  };

  useEffect(() => {
    fetchGodowns();
    fetchDealerParties();
  }, [currentBusiness?.id]);

  useEffect(() => {
    if (activeTab === 'sync_logs') {
      fetchSyncLogs();
    }
  }, [activeTab]);

  // Handle open create modal
  const handleOpenCreate = () => {
    setEditingGodown(null);
    setFormName('');
    setFormCode('');
    setFormType('SECONDARY_WAREHOUSE');
    setFormAddress('');
    setFormContactPerson('');
    setFormMobile('');
    setFormDealerPartyId('');
    setFormStatus('ACTIVE');
    setFormEnableB2bOrderSync(false);
    setFormSyncDirectInvoice(false);
    setFormDefaultProcessingPreference('REQUIRES_ACCEPTANCE');
    setFormSyncStatus('ACTIVE');
    setFormError(null);
    setShowCreateModal(true);
  };

  // Handle open edit modal
  const handleOpenEdit = (godown: Godown) => {
    setEditingGodown(godown);
    setFormName(godown.name);
    setFormCode(godown.code);
    setFormType(godown.godownType);
    setFormAddress(godown.address || '');
    setFormContactPerson(godown.contactPerson || '');
    setFormMobile(godown.mobile || '');
    setFormDealerPartyId(godown.dealerPartyId || '');
    setFormStatus(godown.status);
    setFormEnableB2bOrderSync(!!godown.enableB2bOrderSync);
    setFormSyncDirectInvoice(!!godown.syncDirectInvoice);
    setFormDefaultProcessingPreference(godown.defaultProcessingPreference || 'REQUIRES_ACCEPTANCE');
    setFormSyncStatus(godown.syncStatus || 'ACTIVE');
    setFormError(null);
    setShowCreateModal(true);
  };

  // Save Godown (Create or Update)
  const handleSaveGodown = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Godown Name is required');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      const url = editingGodown ? `/api/godowns/${editingGodown.id}` : '/api/godowns';
      const method = editingGodown ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          name: formName.trim(),
          code: formCode.trim() || undefined,
          godownType: formType,
          address: formAddress.trim() || null,
          contactPerson: formContactPerson.trim() || null,
          mobile: formMobile.trim() || null,
          dealerPartyId: formDealerPartyId || null,
          status: formStatus,
          enableB2bOrderSync: formEnableB2bOrderSync,
          syncDirectInvoice: formSyncDirectInvoice,
          defaultProcessingPreference: formDefaultProcessingPreference,
          syncStatus: formSyncStatus,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to save Extra Godown');
      }

      setShowCreateModal(false);
      await fetchGodowns();
    } catch (err: any) {
      setFormError(err.message || 'Error occurred while saving godown');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle safe toggle deactivation
  const handleToggleStatus = async (godown: Godown) => {
    const nextStatus = godown.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const confirmMsg =
      nextStatus === 'INACTIVE'
        ? `Are you sure you want to deactivate Extra Godown "${godown.name}"? Staff logins will be suspended and vouchers blocked.`
        : `Activate Extra Godown "${godown.name}"?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/godowns/${godown.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          status: nextStatus,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.message || 'Failed to update godown status');
        return;
      }

      await fetchGodowns();
    } catch (err: any) {
      alert(err.message || 'Network error');
    }
  };

  // Staff Management Handlers
  const openStaffModal = async (godown: Godown) => {
    setSelectedGodownForUsers(godown);
    setLoadingUsers(true);
    try {
      const res = await fetch(`/api/godowns/${godown.id}/users`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.users || data.items || []);
        setGodownUsers(list);
      }
    } catch (err) {
      console.error('Failed to load godown users', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleCreateStaffUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGodownForUsers) return;
    if (!newUsername.trim() || !newPassword.trim() || !newFullName.trim()) {
      setUserError('Full Name, Username, and Password are required');
      return;
    }
    setSavingUser(true);
    setUserError(null);
    try {
      const res = await fetch(`/api/godowns/${selectedGodownForUsers.id}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          fullName: newFullName.trim(),
          mobile: newMobile.trim() || null,
          email: newEmail.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to create staff user');
      }

      setShowAddUserModal(false);
      setNewUsername('');
      setNewPassword('');
      setNewFullName('');
      setNewMobile('');
      setNewEmail('');
      await openStaffModal(selectedGodownForUsers);
      await fetchGodowns();
    } catch (err: any) {
      setUserError(err.message || 'Failed to create staff user');
    } finally {
      setSavingUser(false);
    }
  };

  // Stock Balance Handlers
  const openStockModal = async (godown: Godown) => {
    setSelectedGodownForStock(godown);
    setLoadingStock(true);
    try {
      const res = await fetch(`/api/godowns/${godown.id}/stock`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.items || data.stock || []);
        setStockBalances(list);
      }
    } catch (err) {
      console.error('Failed to load godown stock', err);
    } finally {
      setLoadingStock(false);
    }
  };

  // Filtered Godowns
  const filteredGodowns = godowns.filter((g) => {
    const q = searchQuery.toLowerCase();
    return (
      g.name.toLowerCase().includes(q) ||
      g.code.toLowerCase().includes(q) ||
      (g.contactPerson && g.contactPerson.toLowerCase().includes(q)) ||
      (g.mobile && g.mobile.includes(q))
    );
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
              <Building2 className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Extra Godowns & Secondary Warehouses
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage independent secondary warehouse locations, dealer-operated godowns, and staff logins.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchGodowns}
            className="p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
            title="Refresh List"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs hover:shadow-md transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Extra Godown</span>
          </button>
        </div>
      </div>

      {/* Main Content Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('godowns')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'godowns'
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Building className="w-4 h-4" />
          <span>Locations & Godowns ({godowns.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sync_logs')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'sync_logs'
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <History className="w-4 h-4" />
          <span>B2B Order Sync Logs</span>
        </button>
      </div>

      {activeTab === 'godowns' && (
        <>
          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by code, name, contact..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span>Active</span>
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-300 ml-2"></span>
              <span>Inactive</span>
            </div>
          </div>

          {/* Godowns List Grid */}
          {isLoading ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-600 mx-auto mb-2" />
              <p className="text-xs text-slate-500">Loading extra godowns...</p>
            </div>
          ) : filteredGodowns.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-dashed border-slate-300">
              <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-slate-800">No Extra Godowns Found</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                {searchQuery
                  ? 'No locations match your search query.'
                  : 'Create your first secondary warehouse or dealer godown to enable isolated operational accounts.'}
              </p>
              {!searchQuery && (
                <button
                  type="button"
                  onClick={handleOpenCreate}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Extra Godown</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredGodowns.map((godown) => {
                const isInactive = godown.status === 'INACTIVE';
                return (
                  <div
                    key={godown.id}
                    className={`flex flex-col justify-between bg-white rounded-2xl border transition-all ${
                      isInactive
                        ? 'border-slate-200 opacity-70 bg-slate-50/50'
                        : 'border-slate-200 hover:border-blue-300 hover:shadow-sm'
                    } p-5`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            {godown.code}
                          </span>
                          <h3 className="text-base font-bold text-slate-900 mt-1">{godown.name}</h3>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            godown.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-300'
                          }`}
                        >
                          {godown.status}
                        </span>
                      </div>

                      <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                            godown.godownType === 'DEALER_GODOWN'
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}
                        >
                          {godown.godownType === 'DEALER_GODOWN' ? 'Dealer Godown' : 'Secondary Warehouse'}
                        </span>
                        {godown.enableB2bOrderSync && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
                            <ArrowRightLeft className="w-3 h-3 text-emerald-600" />
                            <span>B2B Sync ON</span>
                          </span>
                        )}
                        {godown.dealerPartyName && (
                          <span className="text-[11px] text-slate-500 truncate">
                            Linked: <strong>{godown.dealerPartyName}</strong>
                          </span>
                        )}
                      </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
                    {godown.contactPerson && (
                      <p className="flex items-center gap-1.5">
                        <span className="text-slate-400">Contact:</span>
                        <span className="font-medium text-slate-700">{godown.contactPerson}</span>
                      </p>
                    )}
                    {godown.mobile && (
                      <p className="flex items-center gap-1.5">
                        <span className="text-slate-400">Mobile:</span>
                        <span className="font-mono text-slate-700">{godown.mobile}</span>
                      </p>
                    )}
                    {godown.address && (
                      <p className="text-[11px] text-slate-500 line-clamp-2">
                        {godown.address}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openStaffModal(godown)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium cursor-pointer"
                      title="Manage Staff Logins"
                    >
                      <Users className="w-3.5 h-3.5 text-blue-600" />
                      <span>Staff ({godown.assignedUsersCount || 0})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openStockModal(godown)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium cursor-pointer"
                      title="View Stock Balance"
                    >
                      <Boxes className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Stock</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(godown)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
                      title="Edit Godown"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(godown)}
                      className={`p-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                        godown.status === 'ACTIVE'
                          ? 'text-amber-600 hover:bg-amber-50'
                          : 'text-emerald-600 hover:bg-emerald-50'
                      }`}
                      title={godown.status === 'ACTIVE' ? 'Deactivate Godown' : 'Activate Godown'}
                    >
                      {godown.status === 'ACTIVE' ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  )}

      {/* B2B SYNC LOGS TAB */}
      {activeTab === 'sync_logs' && (
        <div className="space-y-4">
          {/* Filter & Search Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by SO #, PO #, Godown..."
                value={syncLogsSearch}
                onChange={(e) => setSyncLogsSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              {syncLogsSearch && (
                <button
                  onClick={() => setSyncLogsSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-medium">
                {(['ALL', 'SYNCED', 'FAILED', 'CONFLICT'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setSyncLogsFilter(filter)}
                    className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                      syncLogsFilter === filter
                        ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {filter === 'ALL' ? 'All Logs' : filter}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={fetchSyncLogs}
                disabled={loadingSyncLogs}
                className="p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh Logs"
              >
                <RefreshCw className={`w-4 h-4 ${loadingSyncLogs ? 'animate-spin text-blue-600' : ''}`} />
              </button>
            </div>
          </div>

          {/* Logs Table */}
          {loadingSyncLogs ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-600 mx-auto mb-2" />
              <p className="text-xs text-slate-500">Loading synchronization audit trail...</p>
            </div>
          ) : syncLogs.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-dashed border-slate-300">
              <ArrowRightLeft className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-800">No B2B Sync Logs Yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                When Main Business creates or updates Sales Orders for mapped dealer godowns, all synchronization events and statuses will appear here.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Event Type</th>
                    <th className="py-2.5 px-3">Source Voucher</th>
                    <th className="py-2.5 px-3">Destination Godown</th>
                    <th className="py-2.5 px-3">Destination PO #</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    <th className="py-2.5 px-3">Details / Note</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {syncLogs
                    .filter((log) => {
                      if (syncLogsFilter !== 'ALL' && log.status !== syncLogsFilter) return false;
                      if (!syncLogsSearch) return true;
                      const q = syncLogsSearch.toLowerCase();
                      return (
                        log.sourceVoucherNumber?.toLowerCase().includes(q) ||
                        log.destinationGodownName?.toLowerCase().includes(q) ||
                        log.destinationPurchaseOrderNumber?.toLowerCase().includes(q) ||
                        log.errorDetails?.toLowerCase().includes(q)
                      );
                    })
                    .map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {log.eventType}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-600">
                          {log.sourceVoucherNumber}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">{log.destinationGodownName || log.destinationGodownId}</div>
                          {log.destinationGodownCode && (
                            <div className="text-[10px] text-slate-500 font-mono">[{log.destinationGodownCode}]</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-emerald-700 font-semibold">
                          {log.destinationPurchaseOrderNumber || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase font-mono ${
                              log.status === 'SYNCED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : log.status === 'FAILED'
                                ? 'bg-rose-100 text-rose-800'
                                : log.status === 'CONFLICT'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-slate-600 max-w-xs truncate" title={log.errorDetails || undefined}>
                          {log.errorDetails || 'Successfully synchronized'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {(log.status === 'FAILED' || log.status === 'CONFLICT') && (
                            <button
                              type="button"
                              onClick={() => handleRetrySync(log.id)}
                              disabled={retryingLogId === log.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                              title="Retry Sync"
                            >
                              <RefreshCw className={`w-3 h-3 ${retryingLogId === log.id ? 'animate-spin' : ''}`} />
                              <span>Retry</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CREATE / EDIT GODOWN MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                  <Building2 className="w-5 h-5" />
                </span>
                <h2 className="text-base font-bold text-slate-900">
                  {editingGodown ? 'Edit Extra Godown' : 'Create New Extra Godown'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveGodown} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Godown Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Indiranagar Godown"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Godown Code (Unique)
                  </label>
                  <input
                    type="text"
                    placeholder="Auto-generated if blank (e.g. GDN-001)"
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Godown Type <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as any)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  >
                    <option value="SECONDARY_WAREHOUSE">Secondary Warehouse</option>
                    <option value="DEALER_GODOWN">Dealer Godown</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Linked Dealer Party (Optional)
                  </label>
                  <select
                    value={formDealerPartyId}
                    onChange={(e) => setFormDealerPartyId(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  >
                    <option value="">None / Internal Warehouse</option>
                    {dealerParties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.partyCode ? `(${p.partyCode})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Ramesh Kumar"
                    value={formContactPerson}
                    onChange={(e) => setFormContactPerson(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mobile Number
                  </label>
                  <input
                    type="tel"
                    placeholder="e.g. 9876543210"
                    value={formMobile}
                    onChange={(e) => setFormMobile(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Physical Address
                </label>
                <textarea
                  rows={2}
                  placeholder="Complete godown address, landmark, PIN code"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {editingGodown && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Operational Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  >
                    <option value="ACTIVE">ACTIVE (Operational)</option>
                    <option value="INACTIVE">INACTIVE (Locked / Suspended)</option>
                  </select>
                </div>
              )}

              {/* B2B Order Synchronization Configuration */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4 text-blue-600" />
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">
                        B2B Order Synchronization
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Main Business → Extra Godown Purchase Orders
                      </span>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formEnableB2bOrderSync}
                      onChange={(e) => setFormEnableB2bOrderSync(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <p className="text-[11px] text-slate-500">
                  When enabled, Sales Orders created by Main Business for the linked dealer party automatically generate matching Purchase Orders in this godown's procurement register.
                </p>

                {formEnableB2bOrderSync && (
                  <div className="space-y-3 pt-2.5 border-t border-slate-200">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Order Processing Preference
                      </label>
                      <select
                        value={formDefaultProcessingPreference}
                        onChange={(e) => setFormDefaultProcessingPreference(e.target.value as any)}
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      >
                        <option value="REQUIRES_ACCEPTANCE">Require Dealer Confirmation (Manual Acceptance)</option>
                        <option value="AUTO_ACCEPT">Auto-Accept Booking (Documentary PO — Awaiting Inward/GRN)</option>
                      </select>
                    </div>

                    <div className="flex items-start gap-2 pt-1">
                      <input
                        type="checkbox"
                        id="formSyncDirectInvoice"
                        checked={formSyncDirectInvoice}
                        onChange={(e) => setFormSyncDirectInvoice(e.target.checked)}
                        className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <label htmlFor="formSyncDirectInvoice" className="text-xs text-slate-700 cursor-pointer">
                        <span className="font-semibold block">Synchronize Direct Sales Invoices</span>
                        <span className="text-[11px] text-slate-500">Auto-book purchase orders when sales invoices are billed directly without a preceding sales order.</span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Sync Operational Status
                      </label>
                      <select
                        value={formSyncStatus}
                        onChange={(e) => setFormSyncStatus(e.target.value as any)}
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      >
                        <option value="ACTIVE">ACTIVE (Receiving Orders)</option>
                        <option value="INACTIVE">PAUSED / INACTIVE</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{editingGodown ? 'Update Godown' : 'Create Godown'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STAFF LOGINS DRAWER / MODAL */}
      {selectedGodownForUsers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-mono font-bold text-blue-600 uppercase">
                  Staff Login Accounts
                </span>
                <h2 className="text-base font-bold text-slate-900">
                  {selectedGodownForUsers.name} ({selectedGodownForUsers.code})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedGodownForUsers(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                Staff members assigned to this godown are restricted to this location's stock, orders, and sales vouchers.
              </p>
              <button
                type="button"
                onClick={() => setShowAddUserModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shrink-0 cursor-pointer shadow-xs"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add Staff User</span>
              </button>
            </div>

            {loadingUsers ? (
              <div className="py-8 text-center">
                <RefreshCw className="w-5 h-5 animate-spin text-blue-600 mx-auto mb-2" />
                <p className="text-xs text-slate-500">Loading staff accounts...</p>
              </div>
            ) : godownUsers.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-slate-200 rounded-xl">
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-700">No Staff Users Assigned</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Click "Add Staff User" above to create a salesman login for this godown.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                {godownUsers.map((u) => (
                  <div key={u.id} className="p-3 flex items-center justify-between bg-white hover:bg-slate-50">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-slate-900">{u.fullName}</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                          @{u.username}
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                            u.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {u.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-2">
                        {u.mobile && <span>Ph: {u.mobile}</span>}
                        {u.email && <span>• {u.email}</span>}
                        <span>• Role: SALESMAN</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedGodownForUsers(null)}
                className="px-4 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE STAFF USER MODAL */}
      {showAddUserModal && selectedGodownForUsers && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">
                New Staff Login for {selectedGodownForUsers.name}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddUserModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {userError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{userError}</span>
              </div>
            )}

            <form onSubmit={handleCreateStaffUser} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Anand Sharma"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Username <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. anand_gdn"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="Min 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Mobile</label>
                  <input
                    type="tel"
                    placeholder="Mobile number"
                    value={newMobile}
                    onChange={(e) => setNewMobile(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="Staff email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600 space-y-1">
                <p className="font-semibold text-slate-700">Assigned Role & Permissions:</p>
                <p>• Scoped strictly to <strong>{selectedGodownForUsers.name}</strong></p>
                <p>• Permitted: Sales Vouchers, Orders, Receipts, Purchases, Main Warehouse Stock Search</p>
                <p>• Denied: Admin Settings, Business Switching, Other Godowns Stock/Vouchers</p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs disabled:opacity-50"
                >
                  {savingUser ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Create Staff Account</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GODOWN STOCK BALANCE MODAL */}
      {selectedGodownForStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-mono font-bold text-emerald-600 uppercase">
                  Location Stock Balances
                </span>
                <h2 className="text-base font-bold text-slate-900">
                  {selectedGodownForStock.name} ({selectedGodownForStock.code})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedGodownForStock(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter stock by barcode, power, item name..."
                  value={stockSearchQuery}
                  onChange={(e) => setStockSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white"
                />
              </div>
              <span className="text-xs text-slate-500">
                Total Allocated Batches: <strong>{stockBalances.length}</strong>
              </span>
            </div>

            {loadingStock ? (
              <div className="py-12 text-center">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-600 mx-auto mb-2" />
                <p className="text-xs text-slate-500">Loading stock balances...</p>
              </div>
            ) : stockBalances.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-slate-200 rounded-xl">
                <Boxes className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-700">No Stock in this Godown</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Stock is allocated when purchase vouchers or inward stock movements are recorded for this godown.
                </p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Item / Category</th>
                      <th className="py-2 px-3">Optical Power</th>
                      <th className="py-2 px-3">Barcode</th>
                      <th className="py-2 px-3 text-right">Physical Stock</th>
                      <th className="py-2 px-3 text-right">Reserved</th>
                      <th className="py-2 px-3 text-right">Available Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stockBalances
                      .filter((s) => {
                        const q = stockSearchQuery.toLowerCase();
                        return (
                          s.uniqueItemName.toLowerCase().includes(q) ||
                          s.barcode.toLowerCase().includes(q) ||
                          s.formattedPower.toLowerCase().includes(q)
                        );
                      })
                      .map((s) => (
                        <tr key={s.batchId} className="hover:bg-slate-50">
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-900">{s.uniqueItemName}</div>
                            <div className="text-[10px] text-slate-500">{s.categoryName}</div>
                          </td>
                          <td className="py-2 px-3 font-mono font-medium text-slate-700">
                            {s.formattedPower}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-slate-600">
                            {s.barcode}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-slate-900">
                            {Number(s.physicalStock).toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right text-amber-600 font-medium">
                            {Number(s.reservedStock).toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-600">
                            {Number(s.availableStock).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedGodownForStock(null)}
                className="px-4 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
