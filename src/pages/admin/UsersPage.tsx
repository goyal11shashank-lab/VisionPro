import React, { useEffect, useState } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Shield,
  KeyRound,
  Lock,
  Unlock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  X,
  Eye,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { User, Role } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

export const UsersPage: React.FC = () => {
  const { hasPermission, user: currentUser } = useAuth();
  const [userList, setUserList] = useState<User[]>([]);
  const [roleList, setRoleList] = useState<Role[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Add User Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [newUsername, setNewUsername] = useState<string>('');
  const [newFullName, setNewFullName] = useState<string>('');
  const [newEmail, setNewEmail] = useState<string>('');
  const [newMobile, setNewMobile] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [newRoleId, setNewRoleId] = useState<string>('');
  const [newIsSuperAdmin, setNewIsSuperAdmin] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Reset Password Modal State
  const [resetTargetUser, setResetTargetUser] = useState<User | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState<string>('');
  const [isResetting, setIsResetting] = useState<boolean>(false);

  const fetchUsersAndRoles = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersData, rolesData] = await Promise.all([
        apiRequest('/api/users'),
        apiRequest('/api/roles'),
      ]);
      setUserList(usersData);
      setRoleList(rolesData);
      if (rolesData.length > 0 && !newRoleId) {
        setNewRoleId(rolesData[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsersAndRoles();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newFullName || !newPassword || !newRoleId) {
      setError('Please fill in all required fields.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername,
          fullName: newFullName,
          email: newEmail || undefined,
          mobile: newMobile || undefined,
          password: newPassword,
          roleId: newRoleId,
          isSuperAdmin: newIsSuperAdmin,
        }),
      });

      setSuccessMsg(`User '${newUsername}' successfully created.`);
      setIsAddModalOpen(false);
      setNewUsername('');
      setNewFullName('');
      setNewEmail('');
      setNewMobile('');
      setNewPassword('');
      setNewIsSuperAdmin(false);
      await fetchUsersAndRoles();
    } catch (err: any) {
      setError(err.message || 'Failed to create user');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (user: User) => {
    const nextStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await apiRequest(`/api/users/${user.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus }),
      });
      setSuccessMsg(`User status updated to ${nextStatus}.`);
      await fetchUsersAndRoles();
    } catch (err: any) {
      setError(err.message || 'Failed to update user status');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetUser || !resetPasswordVal || resetPasswordVal.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setIsResetting(true);
    try {
      await apiRequest(`/api/users/${resetTargetUser.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: resetPasswordVal }),
      });
      setSuccessMsg(`Password for '${resetTargetUser.username}' reset successfully.`);
      setResetTargetUser(null);
      setResetPasswordVal('');
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setIsResetting(false);
    }
  };

  const filteredUsers = userList.filter(u =>
    u.fullName.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    (u.email && u.email.toLowerCase().includes(search.toLowerCase())) ||
    (u.mobile && u.mobile.includes(search))
  );

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Users className="w-5 h-5 text-blue-600" />
            <span>User Management</span>
          </h2>
          <p className="text-xs text-slate-500">
            Manage user accounts, system authentication, roles and business permissions
          </p>
        </div>

        <button
          id="btn-add-user"
          onClick={() => {
            setError(null);
            setSuccessMsg(null);
            setIsAddModalOpen(true);
          }}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-md shadow-blue-600/20 transition-all flex items-center gap-2"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add New User</span>
        </button>
      </div>

      {/* Messages */}
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

      {/* Search and Table Card */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, username, email, mobile..."
              className="w-full pl-9 pr-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
          </div>
          <button
            onClick={fetchUsersAndRoles}
            disabled={loading}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
            title="Refresh Users"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Users Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/80 text-slate-700 border-b border-slate-100 uppercase tracking-wider text-[10px] font-semibold">
              <tr>
                <th className="px-5 py-3.5">User</th>
                <th className="px-5 py-3.5">Contact Details</th>
                <th className="px-5 py-3.5">Assigned Role</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Last Login</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Loading users from PostgreSQL...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                    No users found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-xs shrink-0">
                          {u.fullName.charAt(0)}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <span>{u.fullName}</span>
                            {u.isSuperAdmin && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-100 text-purple-700">
                                SUPER
                              </span>
                            )}
                          </div>
                          <div className="text-slate-400 font-mono text-[11px]">@{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="text-slate-700">{u.email || '—'}</div>
                      <div className="text-slate-400 text-[11px]">{u.mobile || '—'}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                        {u.roles?.[0]?.name || (u.isSuperAdmin ? 'Super Administrator' : 'Viewer')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        u.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-800'
                          : u.status === 'LOCKED'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          u.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-400'
                        }`}></span>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Never logged in'}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setResetTargetUser(u);
                            setResetPasswordVal('');
                          }}
                          title="Reset User Password"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        {currentUser?.id !== u.id && (
                          <button
                            onClick={() => handleToggleStatus(u)}
                            title={u.status === 'ACTIVE' ? 'Deactivate User' : 'Activate User'}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                          >
                            {u.status === 'ACTIVE' ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-2.5">
                <UserPlus className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-slate-900 text-sm">Create New System User</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Username *</label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="e.g. optician_raj"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    placeholder="e.g. Rajesh Sharma"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Email Address</label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="e.g. rajesh@optical.com"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Mobile Number</label>
                  <input
                    type="tel"
                    value={newMobile}
                    onChange={(e) => setNewMobile(e.target.value)}
                    placeholder="e.g. 9820011223"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Password *</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Assign Role *</label>
                  <select
                    value={newRoleId}
                    onChange={(e) => setNewRoleId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {roleList.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {currentUser?.isSuperAdmin && (
                <div className="p-3 rounded-xl bg-purple-50 border border-purple-200 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="chk-superadmin"
                    checked={newIsSuperAdmin}
                    onChange={(e) => setNewIsSuperAdmin(e.target.checked)}
                    className="rounded text-purple-600 focus:ring-purple-500"
                  />
                  <label htmlFor="chk-superadmin" className="text-purple-900 font-medium text-xs">
                    Grant Super Administrator Privileges (All Businesses & Full Control)
                  </label>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md shadow-blue-600/20"
                >
                  {isSaving ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 text-sm">Reset Password</h3>
              <button onClick={() => setResetTargetUser(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Enter a new secure password for <strong>{resetTargetUser.fullName}</strong> (@{resetTargetUser.username}).
            </p>

            <form onSubmit={handleResetPassword} className="space-y-3 text-xs">
              <input
                type="password"
                required
                minLength={6}
                value={resetPasswordVal}
                onChange={(e) => setResetPasswordVal(e.target.value)}
                placeholder="Enter new password (min 6 chars)"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetTargetUser(null)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isResetting}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium"
                >
                  {isResetting ? 'Saving...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
