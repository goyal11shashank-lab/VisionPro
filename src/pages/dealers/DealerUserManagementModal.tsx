import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  UserPlus,
  UserCheck,
  UserX,
  Search,
  Key,
  Shield,
  Building,
  Check,
  AlertCircle,
  Clock,
  Eye,
  EyeOff,
  UserCog,
  Trash2,
  Lock,
  RefreshCw,
  Mail,
  Phone,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';

export interface DealerUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  status: string;
  isSuperAdmin: boolean;
  roleId: string | null;
  roleCode: string | null;
  roleName: string | null;
  isDefault: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  assignedAt: string;
}

interface RoleOption {
  id: string;
  name: string;
  code: string;
  description?: string;
}

interface DealerUserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  dealerId: string;
  dealerName: string;
  dealerCode?: string;
  onUserCountChanged?: () => void;
}

export const DealerUserManagementModal: React.FC<DealerUserManagementModalProps> = ({
  isOpen,
  onClose,
  dealerId,
  dealerName,
  dealerCode,
  onUserCountChanged,
}) => {
  // Main state
  const [users, setUsers] = useState<DealerUser[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Submodals
  const [activeSubModal, setActiveSubModal] = useState<
    'NONE' | 'CREATE_USER' | 'ASSIGN_EXISTING' | 'EDIT_ROLE' | 'EDIT_PROFILE' | 'MANAGE_ACCESS'
  >('NONE');
  const [selectedUser, setSelectedUser] = useState<DealerUser | null>(null);

  // Form states: Create User
  const [newFullName, setNewFullName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newMobile, setNewMobile] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newConfirmPassword, setNewConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [newRoleId, setNewRoleId] = useState('');
  const [newIsDefault, setNewIsDefault] = useState(true);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dupWarning, setDupWarning] = useState<any | null>(null);

  // Form states: Assign Existing
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<any | null>(null);
  const [assignRoleId, setAssignRoleId] = useState('');
  const [assignIsDefault, setAssignIsDefault] = useState(false);
  const [searchingCandidates, setSearchingCandidates] = useState(false);

  // Form states: Edit Role
  const [editRoleId, setEditRoleId] = useState('');

  // Form states: Edit Profile
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editMobile, setEditMobile] = useState('');

  // Form states: Access Summary
  const [userAccessSummary, setUserAccessSummary] = useState<any | null>(null);
  const [loadingAccessSummary, setLoadingAccessSummary] = useState(false);

  // Fetch users & roles
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [usersRes, rolesRes] = await Promise.all([
        apiRequest<{ success: boolean; users: DealerUser[]; stats: any }>(
          `/api/main/dealers/${dealerId}/users`
        ),
        apiRequest<RoleOption[]>('/api/roles'),
      ]);

      if (usersRes.success) {
        setUsers(usersRes.users);
      }

      // Filter out SUPER_ADMIN for normal dealer assignment
      const filteredRoles = (rolesRes || []).filter(r => r.code !== 'SUPER_ADMIN');
      setRoles(filteredRoles);

      // Default role to MANAGER or ADMIN if available
      const defaultRole = filteredRoles.find(r => r.code === 'MANAGER' || r.code === 'ADMIN') || filteredRoles[0];
      if (defaultRole) {
        setNewRoleId(defaultRole.id);
        setAssignRoleId(defaultRole.id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load dealer users or roles');
    } finally {
      setLoading(false);
    }
  }, [dealerId]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  // Flash message helper
  const showToast = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // Live duplicate checker for Create User
  const handleCheckDuplicate = async (usernameVal: string) => {
    if (!usernameVal || usernameVal.trim().length < 3) {
      setDupWarning(null);
      return;
    }
    try {
      const res = await apiRequest<any>(`/api/main/dealers/${dealerId}/users/check-duplicate`, {
        method: 'POST',
        body: JSON.stringify({ username: usernameVal }),
      });
      if (res.hasDuplicate && res.existingUser) {
        setDupWarning(res.existingUser);
      } else {
        setDupWarning(null);
      }
    } catch {
      // Non-blocking
    }
  };

  // Search candidates for Assign Existing
  const handleSearchCandidates = async (queryVal: string) => {
    setCandidateQuery(queryVal);
    try {
      setSearchingCandidates(true);
      const res = await apiRequest<{ success: boolean; candidates: any[] }>(
        `/api/main/dealers/${dealerId}/users/candidates?q=${encodeURIComponent(queryVal)}`
      );
      if (res.success) {
        setCandidates(res.candidates);
      }
    } catch (err: any) {
      console.warn('Candidate search failed', err);
    } finally {
      setSearchingCandidates(false);
    }
  };

  // Handle Create User Submit
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== newConfirmPassword) {
      setFormError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setFormError('Password must be at least 6 characters');
      return;
    }

    try {
      setFormSubmitting(true);
      setFormError(null);

      const res = await apiRequest<any>(`/api/main/dealers/${dealerId}/users`, {
        method: 'POST',
        body: JSON.stringify({
          fullName: newFullName,
          username: newUsername,
          email: newEmail || undefined,
          mobile: newMobile || undefined,
          password: newPassword,
          confirmPassword: newConfirmPassword,
          roleId: newRoleId,
          isDefault: newIsDefault,
        }),
      });

      if (res.success) {
        showToast(`User ${res.user.username} created successfully`);
        setActiveSubModal('NONE');
        resetCreateForm();
        loadData();
        onUserCountChanged?.();
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to create user');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Handle Assign Existing Submit
  const handleAssignExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCandidate) {
      setFormError('Please select a user to assign');
      return;
    }

    try {
      setFormSubmitting(true);
      setFormError(null);

      const res = await apiRequest<any>(`/api/main/dealers/${dealerId}/users/assign-existing`, {
        method: 'POST',
        body: JSON.stringify({
          userId: selectedCandidate.id,
          roleId: assignRoleId,
          isDefault: assignIsDefault,
        }),
      });

      if (res.success) {
        showToast(`User ${selectedCandidate.username} assigned successfully`);
        setActiveSubModal('NONE');
        setSelectedCandidate(null);
        setCandidateQuery('');
        loadData();
        onUserCountChanged?.();
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to assign user');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Handle Role Change
  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !editRoleId) return;

    try {
      setFormSubmitting(true);
      setFormError(null);

      const res = await apiRequest<any>(
        `/api/main/dealers/${dealerId}/users/${selectedUser.id}/role`,
        {
          method: 'PUT',
          body: JSON.stringify({ roleId: editRoleId }),
        }
      );

      if (res.success) {
        showToast(res.message || 'Role updated successfully');
        setActiveSubModal('NONE');
        setSelectedUser(null);
        loadData();
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to update role');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Handle Make Default Business
  const handleMakeDefault = async (user: DealerUser) => {
    if (user.isDefault) return;
    try {
      const res = await apiRequest<any>(
        `/api/main/dealers/${dealerId}/users/${user.id}/default`,
        {
          method: 'PUT',
        }
      );
      if (res.success) {
        showToast(`${dealerName} set as default login business for ${user.username}`);
        loadData();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to set default business');
    }
  };

  // Handle Status Toggle (Active / Inactive)
  const handleToggleStatus = async (user: DealerUser) => {
    const nextStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const confirmPrompt =
      nextStatus === 'INACTIVE'
        ? `Are you sure you want to deactivate ${user.username}? They will not be able to log in.`
        : `Re-activate ${user.username}?`;

    if (!window.confirm(confirmPrompt)) return;

    try {
      const res = await apiRequest<any>(
        `/api/main/dealers/${dealerId}/users/${user.id}/status`,
        {
          method: 'PUT',
          body: JSON.stringify({ status: nextStatus }),
        }
      );
      if (res.success) {
        showToast(res.message);
        loadData();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update user status');
    }
  };

  // Handle Remove Access
  const handleRemoveAccess = async (user: DealerUser) => {
    const confirmPrompt = `Are you sure you want to remove ${user.username}'s access to ${dealerName}? Their historical audit and transaction records will remain intact.`;
    if (!window.confirm(confirmPrompt)) return;

    try {
      const res = await apiRequest<any>(
        `/api/main/dealers/${dealerId}/users/${user.id}`,
        {
          method: 'DELETE',
        }
      );
      if (res.success) {
        showToast(res.message);
        setActiveSubModal('NONE');
        setSelectedUser(null);
        loadData();
        onUserCountChanged?.();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to remove user access');
    }
  };

  // Handle Edit Profile Submit
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    try {
      setFormSubmitting(true);
      setFormError(null);

      const res = await apiRequest<any>(
        `/api/main/dealers/${dealerId}/users/${selectedUser.id}/profile`,
        {
          method: 'PUT',
          body: JSON.stringify({
            fullName: editFullName,
            email: editEmail || undefined,
            mobile: editMobile || undefined,
          }),
        }
      );

      if (res.success) {
        showToast('User profile updated');
        setActiveSubModal('NONE');
        setSelectedUser(null);
        loadData();
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to update profile');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Load User Access Summary
  const handleOpenAccessSummary = async (user: DealerUser) => {
    setSelectedUser(user);
    setActiveSubModal('MANAGE_ACCESS');
    try {
      setLoadingAccessSummary(true);
      const res = await apiRequest<any>(
        `/api/main/dealers/${dealerId}/users/${user.id}/access`
      );
      if (res.success) {
        setUserAccessSummary(res);
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to load access summary');
    } finally {
      setLoadingAccessSummary(false);
    }
  };

  const resetCreateForm = () => {
    setNewFullName('');
    setNewUsername('');
    setNewEmail('');
    setNewMobile('');
    setNewPassword('');
    setNewConfirmPassword('');
    setNewIsDefault(true);
    setDupWarning(null);
    setFormError(null);
  };

  if (!isOpen) return null;

  // Filtered users list
  const filteredUsers = users.filter(u => {
    const matchesStatus =
      statusFilter === 'ALL' ? true : u.status === statusFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesQuery =
      !q ||
      u.fullName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.roleName && u.roleName.toLowerCase().includes(q));
    return matchesStatus && matchesQuery;
  });

  const activeCount = users.filter(u => u.status === 'ACTIVE').length;
  const inactiveCount = users.filter(u => u.status !== 'ACTIVE').length;

  return (
    <div
      id="dealer-user-management-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
    >
      <div
        id="dealer-user-management-modal"
        className="relative w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6 flex flex-col max-h-[90vh]"
      >
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/75">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">Dealer User Accounts & Access</h3>
                {dealerCode && (
                  <span className="font-mono text-xs px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded">
                    {dealerCode}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Manage logins, roles, and default business access for{' '}
                <span className="font-medium text-slate-800">{dealerName}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              id="btn-refresh-users"
              onClick={loadData}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              id="btn-close-modal"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* NOTIFICATIONS */}
        {successMsg && (
          <div className="mx-6 mt-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {error && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* TOOLBAR */}
        <div className="p-6 pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="input-search-dealer-users"
                type="text"
                placeholder="Search by name, username, role..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  statusFilter === 'ALL' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({users.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  statusFilter === 'ACTIVE'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Active ({activeCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('INACTIVE')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  statusFilter === 'INACTIVE'
                    ? 'bg-white text-slate-600 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Inactive ({inactiveCount})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              id="btn-open-assign-existing"
              onClick={() => {
                setActiveSubModal('ASSIGN_EXISTING');
                setSelectedCandidate(null);
                setCandidateQuery('');
                setFormError(null);
                handleSearchCandidates('');
              }}
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
            >
              <Building className="w-3.5 h-3.5 text-slate-500" />
              Assign Existing User
            </button>
            <button
              type="button"
              id="btn-open-create-user"
              onClick={() => {
                setActiveSubModal('CREATE_USER');
                resetCreateForm();
              }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <UserPlus className="w-3.5 h-3.5" />
              + Create New User
            </button>
          </div>
        </div>

        {/* USERS TABLE */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="py-16 text-center text-xs text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
              Loading authorized users...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-400 space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                <UserCheck className="w-6 h-6" />
              </div>
              <div>
                <p className="font-semibold text-slate-700">No users found for this dealer</p>
                <p className="text-slate-500 mt-1">
                  Create a new login user or assign an existing staff member to get started.
                </p>
              </div>
              <div className="flex justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSubModal('CREATE_USER');
                    resetCreateForm();
                  }}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg shadow-xs"
                >
                  Create First User
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden border border-slate-200 rounded-xl bg-white shadow-xs">
              <table className="w-full text-left text-xs text-slate-600 border-collapse">
                <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Default Business</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map(user => (
                    <tr key={user.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                              user.status === 'ACTIVE'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-200 text-slate-500'
                            }`}
                          >
                            {user.fullName.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                              {user.fullName}
                              {user.isSuperAdmin && (
                                <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.2 rounded font-mono font-bold">
                                  SUPER
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">@{user.username}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            {user.roleName || user.roleCode || 'No Role'}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedUser(user);
                              setEditRoleId(user.roleId || roles[0]?.id || '');
                              setActiveSubModal('EDIT_ROLE');
                            }}
                            className="text-blue-600 hover:text-blue-800 text-[11px] font-medium ml-1"
                            title="Change Role"
                          >
                            Edit
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        {user.isDefault ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <Check className="w-3 h-3" /> Default
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleMakeDefault(user)}
                            className="text-[11px] text-slate-500 hover:text-blue-600 underline font-medium"
                            title="Make this the user's primary login business"
                          >
                            Set as Default
                          </button>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            user.status === 'ACTIVE'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {user.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="space-y-0.5 text-[11px] text-slate-600">
                          {user.email && (
                            <div className="flex items-center gap-1 truncate max-w-[180px]">
                              <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                              <span className="truncate">{user.email}</span>
                            </div>
                          )}
                          {user.mobile && (
                            <div className="flex items-center gap-1">
                              <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                              <span>{user.mobile}</span>
                            </div>
                          )}
                          {!user.email && !user.mobile && <span className="text-slate-400 italic">—</span>}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenAccessSummary(user)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="View all businesses & roles"
                          >
                            <Building className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedUser(user);
                              setEditFullName(user.fullName);
                              setEditEmail(user.email || '');
                              setEditMobile(user.mobile || '');
                              setActiveSubModal('EDIT_PROFILE');
                            }}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors"
                            title="Edit Profile"
                          >
                            <UserCog className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleStatus(user)}
                            className={`p-1.5 rounded transition-colors ${
                              user.status === 'ACTIVE'
                                ? 'text-amber-600 hover:bg-amber-50'
                                : 'text-emerald-600 hover:bg-emerald-50'
                            }`}
                            title={user.status === 'ACTIVE' ? 'Deactivate User' : 'Activate User'}
                          >
                            {user.status === 'ACTIVE' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRemoveAccess(user)}
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                            title="Remove Dealer Access"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* FOOTER STATS */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/75 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <span>
              Total: <strong className="text-slate-800">{users.length}</strong>
            </span>
            <span>
              Active: <strong className="text-emerald-700">{activeCount}</strong>
            </span>
            <span>
              Inactive: <strong className="text-slate-600">{inactiveCount}</strong>
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Passes strict tenant isolation. Passwords are encrypted with bcrypt.
          </p>
        </div>

        {/* SUBMODAL 1: CREATE NEW USER */}
        {activeSubModal === 'CREATE_USER' && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-blue-600" />
                  <h4 className="text-sm font-bold text-slate-800">Create New Dealer Login</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSubModal('NONE')}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateUser} className="p-5 space-y-4">
                {formError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                {dupWarning && (
                  <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg space-y-2">
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      Account already exists: @{dupWarning.username} ({dupWarning.fullName})
                    </div>
                    <p className="text-amber-800 text-[11px]">
                      This username or email is already registered in the system. Would you like to assign this existing user
                      to {dealerName} instead?
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCandidate(dupWarning);
                        setActiveSubModal('ASSIGN_EXISTING');
                        setFormError(null);
                      }}
                      className="px-2.5 py-1 bg-amber-700 text-white rounded font-semibold text-[11px]"
                    >
                      Assign Existing User Instead
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Full Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Ramesh Patel"
                      value={newFullName}
                      onChange={e => setNewFullName(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Username <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. ramesh_optics"
                      value={newUsername}
                      onChange={e => {
                        setNewUsername(e.target.value);
                        handleCheckDuplicate(e.target.value);
                      }}
                      className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                    <input
                      type="email"
                      placeholder="user@example.com"
                      value={newEmail}
                      onChange={e => setNewEmail(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Mobile Number</label>
                    <input
                      type="text"
                      placeholder="e.g. 9876543210"
                      value={newMobile}
                      onChange={e => setNewMobile(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Initial Password <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="Min. 6 characters"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        className="w-full pl-3 pr-8 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Confirm Password <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="Repeat password"
                      value={newConfirmPassword}
                      onChange={e => setNewConfirmPassword(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Assign Role for {dealerName} <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={newRoleId}
                    onChange={e => setNewRoleId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {roles.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 font-medium">
                    <input
                      type="checkbox"
                      checked={newIsDefault}
                      onChange={e => setNewIsDefault(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Set this Dealer as the user's default login business</span>
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setActiveSubModal('NONE')}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSubmitting}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1.5"
                  >
                    {formSubmitting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Creating Account...
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Create User & Grant Access
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* SUBMODAL 2: ASSIGN EXISTING USER */}
        {activeSubModal === 'ASSIGN_EXISTING' && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                  <Building className="w-4 h-4 text-blue-600" />
                  <h4 className="text-sm font-bold text-slate-800">Assign Existing User to {dealerName}</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSubModal('NONE')}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAssignExisting} className="p-5 space-y-4">
                {formError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Search Registered Users
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Type username, name, email..."
                      value={candidateQuery}
                      onChange={e => handleSearchCandidates(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Candidates selection list */}
                <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 bg-slate-50">
                  {searchingCandidates ? (
                    <div className="p-4 text-center text-xs text-slate-400">Searching accounts...</div>
                  ) : candidates.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      {candidateQuery
                        ? 'No matching unassigned active users found'
                        : 'Type above to search existing users'}
                    </div>
                  ) : (
                    candidates.map(cand => (
                      <div
                        key={cand.id}
                        onClick={() => setSelectedCandidate(cand)}
                        className={`p-2.5 flex items-center justify-between cursor-pointer transition-colors ${
                          selectedCandidate?.id === cand.id
                            ? 'bg-blue-50 border-l-4 border-blue-600'
                            : 'hover:bg-white'
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-xs text-slate-900">{cand.fullName}</div>
                          <div className="text-[11px] text-slate-500 font-mono">@{cand.username}</div>
                        </div>
                        {selectedCandidate?.id === cand.id ? (
                          <Check className="w-4 h-4 text-blue-600" />
                        ) : (
                          <span className="text-[10px] text-blue-600 font-semibold">Select</span>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {selectedCandidate && (
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-blue-900">
                    <div className="font-semibold">Selected: {selectedCandidate.fullName}</div>
                    <div className="text-[11px] font-mono text-blue-700">@{selectedCandidate.username}</div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Role in {dealerName} <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={assignRoleId}
                    onChange={e => setAssignRoleId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {roles.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 font-medium">
                    <input
                      type="checkbox"
                      checked={assignIsDefault}
                      onChange={e => setAssignIsDefault(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Make this Dealer their default login business</span>
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setActiveSubModal('NONE')}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSubmitting || !selectedCandidate}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1.5"
                  >
                    {formSubmitting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Assigning...
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Grant Access
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* SUBMODAL 3: EDIT ROLE */}
        {activeSubModal === 'EDIT_ROLE' && selectedUser && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-600" />
                  <h4 className="text-sm font-bold text-slate-800">Change Role for {selectedUser.fullName}</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSubModal('NONE')}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveRole} className="p-5 space-y-4">
                {formError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1">
                  <div>
                    User: <strong className="text-slate-900">{selectedUser.fullName}</strong> (@{selectedUser.username})
                  </div>
                  <div>
                    Current Role:{' '}
                    <span className="font-semibold text-slate-700">
                      {selectedUser.roleName || selectedUser.roleCode}
                    </span>
                  </div>
                  <div>
                    Business Context: <span className="font-semibold text-blue-700">{dealerName}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">New Role</label>
                  <select
                    value={editRoleId}
                    onChange={e => setEditRoleId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {roles.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setActiveSubModal('NONE')}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSubmitting}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1.5"
                  >
                    {formSubmitting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Update Role
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* SUBMODAL 4: EDIT PROFILE */}
        {activeSubModal === 'EDIT_PROFILE' && selectedUser && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                  <UserCog className="w-4 h-4 text-blue-600" />
                  <h4 className="text-sm font-bold text-slate-800">Edit Profile: @{selectedUser.username}</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSubModal('NONE')}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveProfile} className="p-5 space-y-4">
                {formError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={editFullName}
                    onChange={e => setEditFullName(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Mobile Number</label>
                  <input
                    type="text"
                    value={editMobile}
                    onChange={e => setEditMobile(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setActiveSubModal('NONE')}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSubmitting}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1.5"
                  >
                    {formSubmitting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Save Changes
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* SUBMODAL 5: MANAGE ACCESS / BUSINESS MEMBERSHIPS */}
        {activeSubModal === 'MANAGE_ACCESS' && selectedUser && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                  <Building className="w-4 h-4 text-blue-600" />
                  <div>
                    <h4 className="text-sm font-bold text-slate-800">Business Access Summary</h4>
                    <p className="text-[11px] text-slate-500">
                      {selectedUser.fullName} (@{selectedUser.username})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSubModal('NONE')}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                {loadingAccessSummary ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-500" />
                    Loading business memberships...
                  </div>
                ) : userAccessSummary?.businesses?.length > 0 ? (
                  <div className="space-y-2.5">
                    <p className="text-xs text-slate-600">
                      This user has access to the following businesses. Each business maintains its own role assignment:
                    </p>
                    <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                      {userAccessSummary.businesses.map((b: any) => (
                        <div key={b.businessId} className="p-3 bg-white flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-xs text-slate-900">{b.businessName}</span>
                              <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">
                                {b.businessType}
                              </span>
                              {b.isDefault && (
                                <span className="text-[10px] font-bold px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded">
                                  Default
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Role: <strong className="text-slate-700">{b.roleName || b.roleCode || 'None'}</strong>
                            </div>
                          </div>

                          {b.businessId === dealerId && (
                            <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                              Current Dealer
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">No other business memberships found.</div>
                )}

                <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                  <button
                    type="button"
                    onClick={() => handleRemoveAccess(selectedUser)}
                    className="px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove From This Dealer
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSubModal('NONE')}
                    className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg shadow-xs"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
