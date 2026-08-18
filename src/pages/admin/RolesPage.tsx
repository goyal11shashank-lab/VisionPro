import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Plus,
  KeyRound,
  Check,
  X,
  Lock,
  Layers,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Role, Permission } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

export const RolesPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [groupedPermissions, setGroupedPermissions] = useState<Record<string, Permission[]>>({});
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Edit Permissions Modal
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [checkedPermIds, setCheckedPermIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Create Custom Role Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [newRoleName, setNewRoleName] = useState<string>('');
  const [newRoleCode, setNewRoleCode] = useState<string>('');
  const [newRoleDesc, setNewRoleDesc] = useState<string>('');
  const [newRolePermIds, setNewRolePermIds] = useState<string[]>([]);

  const fetchRolesAndPermissions = async () => {
    setLoading(true);
    setError(null);
    try {
      const [rolesData, permsData] = await Promise.all([
        apiRequest('/api/roles'),
        apiRequest('/api/roles/permissions'),
      ]);
      setRoles(rolesData);
      setGroupedPermissions(permsData.grouped || {});
      setAllPermissions(permsData.all || []);
      if (rolesData.length > 0 && !selectedRole) {
        setSelectedRole(rolesData[0]);
      } else if (selectedRole) {
        const updated = rolesData.find((r: Role) => r.id === selectedRole.id);
        if (updated) setSelectedRole(updated);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch roles and permissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRolesAndPermissions();
  }, []);

  const handleOpenEditModal = (role: Role) => {
    setSelectedRole(role);
    const rolePermIds = (role.permissions || []).map(p => p.id);
    setCheckedPermIds(rolePermIds);
    setIsEditModalOpen(true);
    setError(null);
  };

  const handleTogglePermission = (permId: string) => {
    setCheckedPermIds(prev =>
      prev.includes(permId) ? prev.filter(id => id !== permId) : [...prev, permId]
    );
  };

  const handleSaveRolePermissions = async () => {
    if (!selectedRole) return;
    setIsSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/roles/${selectedRole.id}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissionIds: checkedPermIds }),
      });
      setSuccessMsg(`Permissions for role '${selectedRole.name}' updated successfully.`);
      setIsEditModalOpen(false);
      await fetchRolesAndPermissions();
    } catch (err: any) {
      setError(err.message || 'Failed to update role permissions');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateCustomRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName || !newRoleCode) {
      setError('Role name and code are required.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await apiRequest('/api/roles', {
        method: 'POST',
        body: JSON.stringify({
          name: newRoleName,
          code: newRoleCode.toUpperCase().replace(/\s+/g, '_'),
          description: newRoleDesc,
          permissionIds: newRolePermIds,
        }),
      });

      setSuccessMsg(`Custom role '${newRoleName}' created successfully.`);
      setIsCreateModalOpen(false);
      setNewRoleName('');
      setNewRoleCode('');
      setNewRoleDesc('');
      setNewRolePermIds([]);
      await fetchRolesAndPermissions();
    } catch (err: any) {
      setError(err.message || 'Failed to create role');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-purple-600" />
            <span>Roles & Granular Permissions Matrix</span>
          </h2>
          <p className="text-xs text-slate-500">
            Define system and custom roles with fine-grained multi-module permissions
          </p>
        </div>

        <button
          onClick={() => {
            setError(null);
            setSuccessMsg(null);
            setIsCreateModalOpen(true);
          }}
          className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium shadow-md shadow-purple-600/20 transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Create Custom Role</span>
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

      {/* Roles Master-Detail Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Roles List */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h3 className="text-xs font-semibold uppercase text-slate-700 tracking-wider">
              Configured Roles ({roles.length})
            </h3>
            <button
              onClick={fetchRolesAndPermissions}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="space-y-2">
            {roles.map(r => {
              const isSelected = selectedRole?.id === r.id;
              return (
                <div
                  key={r.id}
                  onClick={() => setSelectedRole(r)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all text-xs ${
                    isSelected
                      ? 'bg-purple-50/70 border-purple-300 shadow-xs text-purple-950'
                      : 'bg-slate-50/50 border-slate-200 hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{r.name}</span>
                    {r.isSystem ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">
                        SYSTEM
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">
                        CUSTOM
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">{r.code}</div>
                  <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">{r.description}</div>
                  <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-200/60 text-[11px]">
                    <span className="text-slate-500 font-medium">
                      {r.code === 'SUPER_ADMIN' ? 'All Permissions (Unrestricted)' : `${r.permissionsCount || 0} permissions`}
                    </span>
                    {r.code !== 'SUPER_ADMIN' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEditModal(r);
                        }}
                        className="text-purple-600 hover:text-purple-800 font-medium"
                      >
                        Edit Matrix
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Permission Matrix for Selected Role */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          {selectedRole ? (
            <>
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-purple-600" />
                    <span>Permission Matrix for: {selectedRole.name}</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">{selectedRole.description}</p>
                </div>
                {selectedRole.code !== 'SUPER_ADMIN' && (
                  <button
                    onClick={() => handleOpenEditModal(selectedRole)}
                    className="px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 text-xs font-medium transition-colors"
                  >
                    Modify Permissions
                  </button>
                )}
              </div>

              {/* Module Permissions Grid */}
              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1 custom-scrollbar">
                {(Object.entries(groupedPermissions) as [string, Permission[]][]).map(([moduleName, perms]) => {
                  const rolePermCodes = selectedRole.code === 'SUPER_ADMIN'
                    ? perms.map(p => p.code)
                    : (selectedRole.permissions || []).map(p => p.code);

                  return (
                    <div key={moduleName} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                          Module: {moduleName}
                        </span>
                        <span className="text-[11px] text-slate-500 font-medium">
                          {rolePermCodes.filter(c => perms.some(p => p.code === c)).length} / {perms.length} Enabled
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {perms.map(p => {
                          const isAllowed = selectedRole.code === 'SUPER_ADMIN' || rolePermCodes.includes(p.code);
                          return (
                            <div
                              key={p.id}
                              className={`p-2 rounded-lg border text-xs flex items-start justify-between gap-2 ${
                                isAllowed
                                  ? 'bg-white border-emerald-200 text-slate-900 shadow-2xs'
                                  : 'bg-slate-100/60 border-slate-200 text-slate-400'
                              }`}
                            >
                              <div>
                                <div className="font-semibold text-[11px] font-mono">{p.code}</div>
                                <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{p.description}</div>
                              </div>
                              <span className={`p-1 rounded-full shrink-0 ${isAllowed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-400'}`}>
                                {isAllowed ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-slate-400 text-xs">
              Select a role from the left to inspect and configure its permission matrix.
            </div>
          )}
        </div>
      </div>

      {/* Edit Role Permissions Modal */}
      {isEditModalOpen && selectedRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">
                  Configure Permissions: {selectedRole.name}
                </h3>
                <p className="text-xs text-slate-500">Toggle granular access rights across optical ERP modules</p>
              </div>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 custom-scrollbar">
              {(Object.entries(groupedPermissions) as [string, Permission[]][]).map(([moduleName, perms]) => (
                <div key={moduleName} className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100 pb-1">
                    {moduleName} Module
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {perms.map(p => {
                      const isChecked = checkedPermIds.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className={`p-2.5 rounded-xl border text-xs flex items-start gap-2.5 cursor-pointer transition-colors ${
                            isChecked
                              ? 'bg-purple-50/60 border-purple-300 text-purple-950'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleTogglePermission(p.id)}
                            className="rounded text-purple-600 mt-0.5"
                          />
                          <div>
                            <div className="font-semibold font-mono text-[11px]">{p.code}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{p.description}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {checkedPermIds.length} permissions selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSaveRolePermissions}
                  className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium shadow-md shadow-purple-600/20"
                >
                  {isSaving ? 'Saving...' : 'Save Matrix'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Custom Role Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
              <h3 className="font-semibold text-slate-900 text-sm">Create New Custom Role</h3>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomRole} className="p-6 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Role Name *</label>
                <input
                  type="text"
                  required
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="e.g. Senior Optometrist"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Role Code * (Unique Identifier)</label>
                <input
                  type="text"
                  required
                  value={newRoleCode}
                  onChange={(e) => setNewRoleCode(e.target.value.toUpperCase())}
                  placeholder="e.g. OPTOMETRIST_SENIOR"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Description</label>
                <textarea
                  rows={2}
                  value={newRoleDesc}
                  onChange={(e) => setNewRoleDesc(e.target.value)}
                  placeholder="Specify responsibilities and duties of this role..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium"
                >
                  {isSaving ? 'Creating...' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
