import React, { useEffect, useState } from 'react';
import {
  Users,
  Plus,
  Search,
  RefreshCw,
  Edit3,
  Key,
  Building2,
  Shield,
  CheckCircle2,
  AlertCircle,
  X,
  Star,
  Check,
  UserCheck,
  UserX,
  Lock,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { User, Role, Business, UserBusinessAssignment } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

interface BusinessSelectionState {
  businessId: string;
  roleId: string;
  isDefault: boolean;
}

export const UsersPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [usersList, setUsersList] = useState<User[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [allBusinesses, setAllBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Add User Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [addFormData, setAddFormData] = useState({
    username: '',
    fullName: '',
    email: '',
    mobile: '',
    password: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    isSuperAdmin: false,
  });
  const [addBusinessSelections, setAddBusinessSelections] = useState<Record<string, BusinessSelectionState>>({});
  const [isSavingUser, setIsSavingUser] = useState<boolean>(false);

  // Edit Profile Modal State
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editFormData, setEditFormData] = useState({
    fullName: '',
    email: '',
    mobile: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'LOCKED',
    isSuperAdmin: false,
  });

  // Manage Business Access Modal State
  const [accessModalUser, setAccessModalUser] = useState<User | null>(null);
  const [accessSelections, setAccessSelections] = useState<Record<string, { roleId: string; isDefault: boolean }>>({});
  const [isSavingAccess, setIsSavingAccess] = useState<boolean>(false);

  // Reset Password Modal State
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState<string>('');
  const [isResetting, setIsResetting] = useState<boolean>(false);

  const isCurrentSuperAdmin = Boolean(currentUser?.isSuperAdmin);

  const loadAllData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersData, rolesData, bizData] = await Promise.all([
        apiRequest('/api/users'),
        apiRequest('/api/roles').catch(() => []),
        apiRequest('/api/businesses').catch(() => []),
      ]);
      setUsersList(usersData);
      setAllRoles(rolesData);
      setAllBusinesses(bizData);
    } catch (err: any) {
      setError(err.message || 'Failed to load user administration data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Open Add User Modal
  const openAddModal = () => {
    const defaultRole = allRoles[0]?.id || '';
    const initialSelections: Record<string, BusinessSelectionState> = {};
    if (allBusinesses.length > 0) {
      const firstBiz = allBusinesses[0];
      initialSelections[firstBiz.id] = {
        businessId: firstBiz.id,
        roleId: defaultRole,
        isDefault: true,
      };
    }

    setAddFormData({
      username: '',
      fullName: '',
      email: '',
      mobile: '',
      password: '',
      status: 'ACTIVE',
      isSuperAdmin: false,
    });
    setAddBusinessSelections(initialSelections);
    setError(null);
    setSuccessMsg(null);
    setIsAddModalOpen(true);
  };

  // Toggle business selection in Add modal
  const handleToggleAddBusiness = (bizId: string) => {
    setAddBusinessSelections((prev) => {
      const updated = { ...prev };
      if (updated[bizId]) {
        const wasDefault = updated[bizId].isDefault;
        delete updated[bizId];
        // If the removed one was default, set the first remaining one as default
        const remainingKeys = Object.keys(updated);
        if (wasDefault && remainingKeys.length > 0) {
          updated[remainingKeys[0]].isDefault = true;
        }
      } else {
        const hasExisting = Object.keys(updated).length > 0;
        const defaultRole = allRoles[0]?.id || '';
        updated[bizId] = {
          businessId: bizId,
          roleId: defaultRole,
          isDefault: !hasExisting, // make default if first one
        };
      }
      return updated;
    });
  };

  // Set default business in Add modal
  const handleSetAddDefault = (bizId: string) => {
    setAddBusinessSelections((prev) => {
      const updated: Record<string, BusinessSelectionState> = {};
      for (const key of Object.keys(prev)) {
        updated[key] = {
          ...prev[key],
          isDefault: key === bizId,
        };
      }
      return updated;
    });
  };

  // Handle Create User Submit
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addFormData.username.trim() || !addFormData.fullName.trim() || !addFormData.password.trim()) {
      setError('Username, Full Name, and Password are required.');
      return;
    }

    const assignments = (Object.values(addBusinessSelections) as BusinessSelectionState[]).map((s) => ({
      businessId: s.businessId,
      roleId: s.roleId,
      isDefault: s.isDefault,
    }));

    if (!addFormData.isSuperAdmin && assignments.length === 0) {
      setError('Standard users must be assigned to at least one business.');
      return;
    }

    setIsSavingUser(true);
    setError(null);
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          ...addFormData,
          businessAssignments: assignments,
        }),
      });
      setSuccessMsg(`User '${addFormData.fullName}' created successfully.`);
      setIsAddModalOpen(false);
      await loadAllData();
    } catch (err: any) {
      setError(err.message || 'Failed to create user');
    } finally {
      setIsSavingUser(false);
    }
  };

  // Open Edit Profile Modal
  const openEditModal = (u: User) => {
    setEditingUser(u);
    setEditFormData({
      fullName: u.fullName,
      email: u.email || '',
      mobile: u.mobile || '',
      status: u.status,
      isSuperAdmin: u.isSuperAdmin,
    });
    setError(null);
    setSuccessMsg(null);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      await apiRequest(`/api/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify(editFormData),
      });
      setSuccessMsg(`Profile for '${editFormData.fullName}' updated successfully.`);
      setEditingUser(null);
      await loadAllData();
    } catch (err: any) {
      setError(err.message || 'Failed to update user profile');
    }
  };

  // Open Manage Business Access Modal
  const openAccessModal = (u: User) => {
    setAccessModalUser(u);
    const selections: Record<string, { roleId: string; isDefault: boolean }> = {};
    const defaultRole = allRoles[0]?.id || '';

    if (u.authorizedBusinesses && u.authorizedBusinesses.length > 0) {
      for (const b of u.authorizedBusinesses) {
        selections[b.businessId] = {
          roleId: b.role?.id || defaultRole,
          isDefault: Boolean(b.isDefault),
        };
      }
    }

    setAccessSelections(selections);
    setError(null);
    setSuccessMsg(null);
  };

  const handleToggleAccessBusiness = (bizId: string) => {
    setAccessSelections((prev) => {
      const updated = { ...prev };
      if (updated[bizId]) {
        const wasDefault = updated[bizId].isDefault;
        delete updated[bizId];
        const remainingKeys = Object.keys(updated);
        if (wasDefault && remainingKeys.length > 0) {
          updated[remainingKeys[0]].isDefault = true;
        }
      } else {
        const hasExisting = Object.keys(updated).length > 0;
        const defaultRole = allRoles[0]?.id || '';
        updated[bizId] = {
          roleId: defaultRole,
          isDefault: !hasExisting,
        };
      }
      return updated;
    });
  };

  const handleSetAccessDefault = (bizId: string) => {
    setAccessSelections((prev) => {
      const updated: Record<string, { roleId: string; isDefault: boolean }> = {};
      for (const key of Object.keys(prev)) {
        updated[key] = {
          ...prev[key],
          isDefault: key === bizId,
        };
      }
      return updated;
    });
  };

  const handleSaveAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessModalUser) return;

    const assignments = (Object.entries(accessSelections) as Array<[string, { roleId: string; isDefault: boolean }]>).map(([bizId, val]) => ({
      businessId: bizId,
      roleId: val.roleId,
    }));

    const defaultEntry = (Object.entries(accessSelections) as Array<[string, { roleId: string; isDefault: boolean }]>).find(([_, val]) => val.isDefault);
    const defaultBusinessId = defaultEntry ? defaultEntry[0] : assignments[0]?.businessId || null;

    if (!accessModalUser.isSuperAdmin && assignments.length === 0) {
      setError('Standard users must be assigned to at least one business.');
      return;
    }

    setIsSavingAccess(true);
    try {
      await apiRequest(`/api/users/${accessModalUser.id}/business-access`, {
        method: 'PUT',
        body: JSON.stringify({
          assignments,
          defaultBusinessId,
        }),
      });
      setSuccessMsg(`Business access and roles updated for '${accessModalUser.fullName}'.`);
      setAccessModalUser(null);
      await loadAllData();
    } catch (err: any) {
      setError(err.message || 'Failed to update user business access');
    } finally {
      setIsSavingAccess(false);
    }
  };

  // Toggle user status
  const handleToggleStatus = async (u: User) => {
    const nextStatus = u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await apiRequest(`/api/users/${u.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus }),
      });
      setSuccessMsg(`User '${u.fullName}' status updated to ${nextStatus}.`);
      await loadAllData();
    } catch (err: any) {
      setError(err.message || 'Failed to update user status');
    }
  };

  // Reset Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUser || !newPassword || newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }

    setIsResetting(true);
    try {
      await apiRequest(`/api/users/${resetUser.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      });
      setSuccessMsg(`Password for '${resetUser.fullName}' reset successfully.`);
      setResetUser(null);
      setNewPassword('');
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setIsResetting(false);
    }
  };

  const filteredUsers = usersList.filter((u) => {
    const matchesSearch =
      u.fullName.toLowerCase().includes(search.toLowerCase()) ||
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      (u.email && u.email.toLowerCase().includes(search.toLowerCase())) ||
      (u.mobile && u.mobile.includes(search));

    const matchesStatus =
      statusFilter === 'ALL'
        ? true
        : statusFilter === 'ACTIVE'
        ? u.status === 'ACTIVE'
        : u.status !== 'ACTIVE';

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Users className="w-5 h-5 text-blue-600" />
            <span>User Access & Role Administration</span>
          </h2>
          <p className="text-xs text-slate-500">
            Manage system accounts, multi-tenant business authorizations, per-business role matrix, and default logins
          </p>
        </div>

        <button
          id="btn-add-user"
          onClick={openAddModal}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-md shadow-blue-600/20 transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Add New User</span>
        </button>
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
              placeholder="Search by name, username, email, phone..."
              className="w-full pl-9 pr-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
          </div>

          {/* Filter Pills & Refresh */}
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-100 p-0.5 rounded-xl text-xs">
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === 'ALL' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({usersList.length})
              </button>
              <button
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === 'ACTIVE' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Active ({usersList.filter((u) => u.status === 'ACTIVE').length})
              </button>
              <button
                onClick={() => setStatusFilter('INACTIVE')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === 'INACTIVE' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Inactive ({usersList.filter((u) => u.status !== 'ACTIVE').length})
              </button>
            </div>

            <button
              onClick={loadAllData}
              disabled={loading}
              className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600"
              title="Refresh Users"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Users Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/80 text-slate-700 border-b border-slate-100 uppercase tracking-wider text-[10px] font-semibold">
              <tr>
                <th className="px-5 py-3.5">User Details</th>
                <th className="px-5 py-3.5">Authorized Businesses & Roles</th>
                <th className="px-5 py-3.5">Default Business</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Loading user directory...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                    No users found matching your search.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isActive = u.status === 'ACTIVE';
                  const isSelf = currentUser?.id === u.id;

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* User Details */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-start gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                            u.isSuperAdmin
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-100'
                          }`}>
                            {u.fullName.charAt(0)}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                              <span>{u.fullName}</span>
                              {isSelf && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">
                                  You
                                </span>
                              )}
                              {u.isSuperAdmin && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 flex items-center gap-0.5">
                                  <Shield className="w-3 h-3" />
                                  Super Admin
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">@{u.username}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {[u.email, u.mobile].filter(Boolean).join(' • ') || 'No contact details'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Authorized Businesses & Roles */}
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1.5 max-w-sm">
                          {u.authorizedBusinesses && u.authorizedBusinesses.length > 0 ? (
                            u.authorizedBusinesses.map((ab) => (
                              <div
                                key={ab.businessId}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border ${
                                  ab.isDefault
                                    ? 'bg-blue-50 border-blue-200 text-blue-800 font-medium'
                                    : 'bg-slate-50 border-slate-200 text-slate-700'
                                }`}
                              >
                                <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                                <span>{ab.businessName}</span>
                                {ab.role && (
                                  <span className="text-[10px] px-1 py-0.2 bg-white rounded border border-slate-200 text-slate-500 font-medium">
                                    {ab.role.name}
                                  </span>
                                )}
                                {ab.isDefault && (
                                  <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0 ml-0.5" title="Default Business" />
                                )}
                              </div>
                            ))
                          ) : u.isSuperAdmin ? (
                            <span className="text-[11px] text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                              System-Wide Access (Super Admin)
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">No business access</span>
                          )}
                        </div>
                      </td>

                      {/* Default Business */}
                      <td className="px-5 py-3.5">
                        {u.defaultBusinessName ? (
                          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-800">
                            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                            <span>{u.defaultBusinessName}</span>
                          </div>
                        ) : u.isSuperAdmin ? (
                          <span className="text-[11px] text-slate-400">First Active Business</span>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">None set</span>
                        )}
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
                          {u.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openAccessModal(u)}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-blue-600"
                            title="Configure Authorized Businesses & Roles"
                          >
                            <Building2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => openEditModal(u)}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600"
                            title="Edit User Profile"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => {
                              setResetUser(u);
                              setNewPassword('');
                            }}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600"
                            title="Reset Password"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>

                          {!isSelf && (
                            <button
                              onClick={() => handleToggleStatus(u)}
                              className={`p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 ${
                                isActive ? 'text-amber-600 hover:text-amber-700' : 'text-emerald-600 hover:text-emerald-700'
                              }`}
                              title={isActive ? 'Deactivate User' : 'Activate User'}
                            >
                              {isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
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

      {/* MODAL 1: Add New User */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Users className="w-4 h-4 text-blue-600" />
                <span>Create New User Account</span>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
              {/* Account Credentials */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Username <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={addFormData.username}
                    onChange={(e) => setAddFormData({ ...addFormData, username: e.target.value.toLowerCase().replace(/\s/g, '') })}
                    placeholder="e.g. john_sales"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={addFormData.fullName}
                    onChange={(e) => setAddFormData({ ...addFormData, fullName: e.target.value })}
                    placeholder="e.g. John Doe"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Initial Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={addFormData.password}
                    onChange={(e) => setAddFormData({ ...addFormData, password: e.target.value })}
                    placeholder="Min 6 characters"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Email Address</label>
                  <input
                    type="email"
                    value={addFormData.email}
                    onChange={(e) => setAddFormData({ ...addFormData, email: e.target.value })}
                    placeholder="john@example.com"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Mobile Number</label>
                  <input
                    type="text"
                    value={addFormData.mobile}
                    onChange={(e) => setAddFormData({ ...addFormData, mobile: e.target.value })}
                    placeholder="10-digit mobile"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                {isCurrentSuperAdmin && (
                  <div className="flex items-center gap-2 pt-5">
                    <input
                      type="checkbox"
                      id="add-is-super-admin"
                      checked={addFormData.isSuperAdmin}
                      onChange={(e) => setAddFormData({ ...addFormData, isSuperAdmin: e.target.checked })}
                      className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
                    />
                    <label htmlFor="add-is-super-admin" className="text-slate-800 font-semibold flex items-center gap-1 cursor-pointer">
                      <Shield className="w-3.5 h-3.5 text-purple-600" />
                      <span>Grant Super Administrator Privilege</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Multi-tenant Business Authorization Matrix */}
              <div className="space-y-3 pt-3 border-t border-slate-100">
                <div>
                  <h4 className="font-bold text-slate-900 text-xs">
                    Authorized Businesses & Role Matrix
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Select businesses this user can access. Exactly one must be set as Default Business for login.
                  </p>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {allBusinesses.map((biz) => {
                    const isSelected = Boolean(addBusinessSelections[biz.id]);
                    const currentSelection = addBusinessSelections[biz.id];

                    return (
                      <div
                        key={biz.id}
                        className={`p-3 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          isSelected ? 'bg-blue-50/40' : 'hover:bg-slate-50/50'
                        }`}
                      >
                        {/* Checkbox & Business Info */}
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleAddBusiness(biz.id)}
                            className="w-4 h-4 mt-0.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                          />
                          <div>
                            <div className="font-semibold text-slate-900">{biz.name}</div>
                            <div className="text-[10px] text-slate-400">{biz.tradeName || 'Standard Entity'}</div>
                          </div>
                        </label>

                        {/* Role selector & Default Radio */}
                        {isSelected && (
                          <div className="flex items-center gap-4 pl-6 sm:pl-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-slate-500">Role:</span>
                              <select
                                value={currentSelection?.roleId || ''}
                                onChange={(e) => {
                                  const roleId = e.target.value;
                                  setAddBusinessSelections((prev) => ({
                                    ...prev,
                                    [biz.id]: { ...prev[biz.id], roleId },
                                  }));
                                }}
                                className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs"
                              >
                                {allRoles.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer">
                              <input
                                type="radio"
                                name="add-default-business"
                                checked={Boolean(currentSelection?.isDefault)}
                                onChange={() => handleSetAddDefault(biz.id)}
                                className="w-3.5 h-3.5 text-amber-500 border-slate-300 focus:ring-amber-500"
                              />
                              <Star className={`w-3.5 h-3.5 ${currentSelection?.isDefault ? 'text-amber-500 fill-amber-500' : 'text-slate-300'}`} />
                              <span>Default Login</span>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingUser}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md shadow-blue-600/20 disabled:opacity-50 flex items-center gap-2"
                >
                  {isSavingUser && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create User</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Manage Business Access for Existing User */}
      {accessModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                  <Building2 className="w-4 h-4 text-blue-600" />
                  <span>Authorized Businesses: {accessModalUser.fullName}</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Assign authorized businesses, per-business roles, and default login context
                </div>
              </div>
              <button
                onClick={() => setAccessModalUser(null)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveAccess} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                {allBusinesses.map((biz) => {
                  const isSelected = Boolean(accessSelections[biz.id]);
                  const currentSelection = accessSelections[biz.id];

                  return (
                    <div
                      key={biz.id}
                      className={`p-3.5 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isSelected ? 'bg-blue-50/40' : 'hover:bg-slate-50/50'
                      }`}
                    >
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleAccessBusiness(biz.id)}
                          className="w-4 h-4 mt-0.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                        />
                        <div>
                          <div className="font-semibold text-slate-900">{biz.name}</div>
                          <div className="text-[10px] text-slate-400">{biz.city || 'Standard Tenant'}</div>
                        </div>
                      </label>

                      {isSelected && (
                        <div className="flex items-center gap-4 pl-6 sm:pl-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-slate-500">Role:</span>
                            <select
                              value={currentSelection?.roleId || ''}
                              onChange={(e) => {
                                const roleId = e.target.value;
                                setAccessSelections((prev) => ({
                                  ...prev,
                                  [biz.id]: { ...prev[biz.id], roleId },
                                }));
                              }}
                              className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs"
                            >
                              {allRoles.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer">
                            <input
                              type="radio"
                              name="manage-default-business"
                              checked={Boolean(currentSelection?.isDefault)}
                              onChange={() => handleSetAccessDefault(biz.id)}
                              className="w-3.5 h-3.5 text-amber-500 border-slate-300 focus:ring-amber-500"
                            />
                            <Star className={`w-3.5 h-3.5 ${currentSelection?.isDefault ? 'text-amber-500 fill-amber-500' : 'text-slate-300'}`} />
                            <span>Default</span>
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAccessModalUser(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingAccess}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md shadow-blue-600/20 disabled:opacity-50 flex items-center gap-2"
                >
                  {isSavingAccess && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Access Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Edit Profile */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-xl overflow-hidden p-6 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">Edit User Profile</h3>
              <button onClick={() => setEditingUser(null)} className="text-slate-400 font-bold">✕</button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-medium mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editFormData.fullName}
                  onChange={(e) => setEditFormData({ ...editFormData, fullName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={editFormData.email}
                  onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Mobile Number</label>
                <input
                  type="text"
                  value={editFormData.mobile}
                  onChange={(e) => setEditFormData({ ...editFormData, mobile: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Status</label>
                <select
                  value={editFormData.status}
                  onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="LOCKED">LOCKED</option>
                </select>
              </div>

              {isCurrentSuperAdmin && (
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="edit-is-super-admin"
                    checked={editFormData.isSuperAdmin}
                    onChange={(e) => setEditFormData({ ...editFormData, isSuperAdmin: e.target.checked })}
                    className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
                  />
                  <label htmlFor="edit-is-super-admin" className="text-slate-800 font-semibold cursor-pointer">
                    Super Administrator
                  </label>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white font-medium shadow-xs"
                >
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Reset Password */}
      {resetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-xl overflow-hidden p-6 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Key className="w-4 h-4 text-blue-600" />
                <span>Reset Password for {resetUser.fullName}</span>
              </div>
              <button onClick={() => setResetUser(null)} className="text-slate-400 font-bold">✕</button>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  New Password (min 6 characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetUser(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isResetting}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white font-medium shadow-xs disabled:opacity-50"
                >
                  {isResetting ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersPage;
