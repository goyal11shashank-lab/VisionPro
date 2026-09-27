import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Shield,
  CreditCard,
  Lock,
  UserCheck,
  Edit2,
  Power,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  MapPin,
  FileText,
  Clock,
  Loader2,
  X,
  Users,
  UserPlus,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { DealerUserManagementModal } from './DealerUserManagementModal';

interface DealerAdministrationTabProps {
  dealerId: string;
  onRefreshDealer: () => void;
  onNavigate?: (path: string) => void;
  onDealerDeleted?: () => void;
}

export const DealerAdministrationTab: React.FC<DealerAdministrationTabProps> = ({
  dealerId,
  onRefreshDealer,
  onNavigate,
  onDealerDeleted,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminData, setAdminData] = useState<any | null>(null);

  // Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState<any>({});
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Deactivate / Activate State
  const [showDeactModal, setShowDeactModal] = useState(false);
  const [deactWarnings, setDeactWarnings] = useState<any | null>(null);
  const [deactSubmitting, setDeactSubmitting] = useState(false);

  // Delete State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Phase 4B: Dealer User Management Modal State
  const [showUsersModal, setShowUsersModal] = useState(false);

  const fetchAdminData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<{ success: boolean } & any>(
        `/api/main/dealers/${dealerId}/administration`
      );
      if (res.success) {
        setAdminData(res);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load dealer administration data');
    } finally {
      setLoading(false);
    }
  }, [dealerId]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  // Open Edit Modal
  const handleOpenEdit = () => {
    if (!adminData?.dealer) return;
    setEditFormData({
      name: adminData.dealer.name || '',
      tradeName: adminData.dealer.tradeName || '',
      phone: adminData.dealer.phone || '',
      email: adminData.dealer.email || '',
      addressLine1: adminData.dealer.addressLine1 || '',
      addressLine2: adminData.dealer.addressLine2 || '',
      city: adminData.dealer.city || '',
      state: adminData.dealer.state || '',
      stateCode: adminData.dealer.stateCode || '',
      pincode: adminData.dealer.pincode || '',
      gstin: adminData.dealer.gstin || '',
      pan: adminData.dealer.pan || '',
      creditLimit: adminData.customerParty?.creditLimit || 0,
      creditDays: adminData.customerParty?.creditDays || 30,
      syncToCustomerParty: true,
    });
    setEditError(null);
    setShowEditModal(true);
  };

  // Submit Edit
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setEditSubmitting(true);
      setEditError(null);

      const res = await apiRequest<{ success: boolean; message?: string }>(
        `/api/main/dealers/${dealerId}`,
        {
          method: 'PUT',
          body: JSON.stringify(editFormData),
        }
      );

      if (res.success) {
        setShowEditModal(false);
        fetchAdminData();
        onRefreshDealer();
      }
    } catch (err: any) {
      setEditError(err.message || 'Failed to update dealer');
    } finally {
      setEditSubmitting(false);
    }
  };

  // Check warnings before deactivation
  const handleInitiateDeactivate = async () => {
    try {
      setDeactSubmitting(true);
      const res = await apiRequest<{ success: boolean; warnings: string[]; hasOperationalDependencies: boolean }>(
        `/api/main/dealers/${dealerId}/deactivation-warnings`
      );
      if (res.success) {
        setDeactWarnings(res);
        setShowDeactModal(true);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to check deactivation dependencies');
    } finally {
      setDeactSubmitting(false);
    }
  };

  // Confirm Deactivate
  const handleConfirmDeactivate = async () => {
    try {
      setDeactSubmitting(true);
      const res = await apiRequest<{ success: boolean; message?: string }>(
        `/api/main/dealers/${dealerId}/deactivate`,
        { method: 'POST' }
      );
      if (res.success) {
        setShowDeactModal(false);
        fetchAdminData();
        onRefreshDealer();
      }
    } catch (err: any) {
      alert(err.message || 'Failed to deactivate dealer');
    } finally {
      setDeactSubmitting(false);
    }
  };

  // Confirm Activate
  const handleActivate = async () => {
    try {
      setDeactSubmitting(true);
      const res = await apiRequest<{ success: boolean; message?: string }>(
        `/api/main/dealers/${dealerId}/activate`,
        { method: 'POST' }
      );
      if (res.success) {
        fetchAdminData();
        onRefreshDealer();
      }
    } catch (err: any) {
      alert(err.message || 'Failed to activate dealer');
    } finally {
      setDeactSubmitting(false);
    }
  };

  // Confirm Delete
  const handleConfirmDelete = async () => {
    try {
      setDeleteSubmitting(true);
      setDeleteError(null);
      const res = await apiRequest<{ success: boolean; message?: string }>(
        `/api/main/dealers/${dealerId}`,
        { method: 'DELETE' }
      );
      if (res.success) {
        setShowDeleteModal(false);
        if (onDealerDeleted) onDealerDeleted();
      }
    } catch (err: any) {
      setDeleteError(err.message || 'Cannot delete dealer');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-slate-400">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
        <span className="text-xs">Loading dealer administration details...</span>
      </div>
    );
  }

  if (error || !adminData) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center justify-between">
        <span>{error || 'Administration record not found'}</span>
        <button onClick={fetchAdminData} className="px-3 py-1 bg-red-100 font-bold rounded hover:bg-red-200">
          Retry
        </button>
      </div>
    );
  }

  const { dealer, parentWarehouse, customerParty, supplierParty, shareStockWithMain, userCount } = adminData;
  const isInactive = dealer.status === 'INACTIVE';

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 tracking-tight">Dealer Administration & Linkages</h3>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                isInactive ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {dealer.status}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Phase 4A onboarding master record, multi-tenant party isolation, and administrative controls.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-xs"
          >
            <Edit2 className="w-3.5 h-3.5 text-slate-500" />
            Edit Master Details
          </button>

          {isInactive ? (
            <button
              onClick={handleActivate}
              disabled={deactSubmitting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 shadow-xs"
            >
              <Power className="w-3.5 h-3.5 text-emerald-600" />
              Activate Dealer
            </button>
          ) : (
            <button
              onClick={handleInitiateDeactivate}
              disabled={deactSubmitting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 shadow-xs"
            >
              <Power className="w-3.5 h-3.5 text-amber-600" />
              Deactivate Dealer
            </button>
          )}

          <button
            onClick={() => {
              setDeleteError(null);
              setShowDeleteModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-300 rounded-lg hover:bg-rose-100 shadow-xs"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-600" />
            Delete Dealer
          </button>
        </div>
      </div>

      {/* Grid of Key Administration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Dealer Business Master Identity */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-600" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Dealer Business Master</h4>
            </div>
            <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              {dealer.code || 'N/A'}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-slate-500">Legal Company Name</dt>
              <dd className="font-semibold text-slate-900">{dealer.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Trade / Display Name</dt>
              <dd className="font-medium text-slate-800">{dealer.tradeName || '-'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">GSTIN</dt>
              <dd className="font-mono font-medium text-slate-800">{dealer.gstin || 'Unregistered'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">PAN</dt>
              <dd className="font-mono font-medium text-slate-800">{dealer.pan || '-'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Phone</dt>
              <dd className="font-medium text-slate-800">{dealer.phone || '-'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Email</dt>
              <dd className="font-medium text-slate-800">{dealer.email || '-'}</dd>
            </div>
            <div className="col-span-2 pt-1 border-t border-slate-100">
              <dt className="text-slate-500">Registered Address</dt>
              <dd className="text-slate-700 mt-0.5">
                {[dealer.addressLine1, dealer.addressLine2, dealer.city, dealer.state, dealer.pincode]
                  .filter(Boolean)
                  .join(', ') || 'No address specified'}
              </dd>
            </div>
          </dl>
        </div>

        {/* 2. Parent Main Warehouse Anchor */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-600" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Parent Main Warehouse</h4>
            </div>
            <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              Commercial Authority
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-slate-500">Warehouse Name</dt>
              <dd className="font-semibold text-slate-900">{parentWarehouse?.name || 'Main Warehouse'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Trade Name</dt>
              <dd className="font-medium text-slate-800">{parentWarehouse?.trade_name || '-'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Warehouse GSTIN</dt>
              <dd className="font-mono font-medium text-slate-800">{parentWarehouse?.gstin || '-'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">State / Region</dt>
              <dd className="font-medium text-slate-800">{parentWarehouse?.state || '-'}</dd>
            </div>
            <div className="col-span-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
              The Dealer Business operates under the commercial oversight of this parent Main Warehouse. All inter-company
              orders, shipments, and price books originate from here.
            </div>
          </dl>
        </div>

        {/* 3. Linked Main Customer Party */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-blue-600" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Linked Main Customer Party
              </h4>
            </div>
            {customerParty?.partyCode && (
              <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                {customerParty.partyCode}
              </span>
            )}
          </div>

          {customerParty ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-slate-500">Party Name</dt>
                <dd className="font-semibold text-slate-900">{customerParty.name}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Party Status</dt>
                <dd>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      customerParty.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {customerParty.status}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Approved Credit Limit</dt>
                <dd className="font-bold text-slate-900">
                  {customerParty.creditLimit > 0
                    ? `₹${Number(customerParty.creditLimit).toLocaleString('en-IN')}`
                    : '₹0.00 (Advance / Cash Only)'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Payment Terms</dt>
                <dd className="font-medium text-slate-800">{customerParty.creditDays || 0} Days</dd>
              </div>
              <div className="col-span-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  Tag: <code className="bg-slate-100 px-1 rounded">[DEALER_BIZ:{dealer.id.slice(0, 8)}...]</code>
                </span>
                {onNavigate && (
                  <button
                    onClick={() => onNavigate(`/parties/${customerParty.id}`)}
                    className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    View Customer Ledger <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </div>
            </dl>
          ) : (
            <div className="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg">
              No linked Customer Party found in Main Warehouse. Use &apos;Edit Master Details&apos; to link one.
            </div>
          )}
        </div>

        {/* 4. Dealer-side Main Supplier Party */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-600" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Dealer-Side Main Supplier Party
              </h4>
            </div>
            {supplierParty?.partyCode && (
              <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                {supplierParty.partyCode}
              </span>
            )}
          </div>

          {supplierParty ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-slate-500">Supplier Name (In Dealer)</dt>
                <dd className="font-semibold text-slate-900">{supplierParty.name}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Mapping Mode</dt>
                <dd className="text-purple-700 font-medium bg-purple-50 px-1.5 py-0.5 rounded text-[11px] inline-block">
                  Auto-Provisioned
                </dd>
              </div>
              <div className="col-span-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                Dealer orders and goods receipt notes (GRN) within the dealer entity post purchase bills and ledger credits
                strictly against this supplier party account.
              </div>
            </dl>
          ) : (
            <div className="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg">
              Supplier party not yet resolved inside dealer database.
            </div>
          )}
        </div>

        {/* 5. Stock Sharing Policy */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-slate-700" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Stock Sharing Policy</h4>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                shareStockWithMain ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {shareStockWithMain ? 'Enabled' : 'Private (OFF)'}
            </span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            By default, dealer inventory is private to protect competitive dealer stock confidentiality. Dealer
            administrators can voluntarily toggle optical inventory visibility to the Main Warehouse from their portal
            settings. Private cost prices and margins are never shared.
          </p>
        </div>

        {/* 6. User Access & Login Accounts */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-blue-600" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">User Accounts & Logins</h4>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                {adminData?.activeUserCount ?? userCount} Active
              </span>
              {Boolean(adminData?.inactiveUserCount) && (
                <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                  {adminData.inactiveUserCount} Inactive
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-slate-600 leading-relaxed">
              Users log in using their system account and are securely scoped to{' '}
              <strong className="text-slate-800">{dealer.name}</strong> via business-specific roles and default workspace settings.
            </p>

            {adminData?.sampleUsers && adminData.sampleUsers.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {adminData.sampleUsers.map((su: any) => (
                  <span
                    key={su.id}
                    className="inline-flex items-center gap-1.5 text-[11px] bg-slate-50 border border-slate-200 text-slate-700 px-2 py-0.5 rounded-full"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="font-medium">{su.fullName}</span>
                    <span className="text-slate-400 font-mono text-[10px]">({su.roleName || 'Member'})</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="pt-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              Total {userCount} login account{userCount === 1 ? '' : 's'} provisioned
            </span>
            <button
              type="button"
              id="btn-manage-dealer-users"
              onClick={() => setShowUsersModal(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <Users className="w-3.5 h-3.5" />
              Manage Users & Logins
            </button>
          </div>
        </div>
      </div>

      {/* DEALER USER MANAGEMENT MODAL */}
      {showUsersModal && (
        <DealerUserManagementModal
          isOpen={showUsersModal}
          onClose={() => {
            setShowUsersModal(false);
            fetchAdminData();
          }}
          dealerId={dealer.id}
          dealerName={dealer.name}
          dealerCode={dealer.code}
          onUserCountChanged={() => {
            fetchAdminData();
            onRefreshDealer();
          }}
        />
      )}

      {/* EDIT DEALER MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl my-8 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-base font-bold">Edit Dealer Master Details</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {editError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{editError}</div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Legal Name *</label>
                  <input
                    type="text"
                    required
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Trade / Display Name</label>
                  <input
                    type="text"
                    value={editFormData.tradeName}
                    onChange={(e) => setEditFormData({ ...editFormData, tradeName: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Phone</label>
                  <input
                    type="tel"
                    value={editFormData.phone}
                    onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Email</label>
                  <input
                    type="email"
                    value={editFormData.email}
                    onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">GSTIN</label>
                  <input
                    type="text"
                    maxLength={15}
                    value={editFormData.gstin}
                    onChange={(e) => setEditFormData({ ...editFormData, gstin: e.target.value.toUpperCase() })}
                    className="w-full text-xs font-mono uppercase px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">PAN</label>
                  <input
                    type="text"
                    maxLength={10}
                    value={editFormData.pan}
                    onChange={(e) => setEditFormData({ ...editFormData, pan: e.target.value.toUpperCase() })}
                    className="w-full text-xs font-mono uppercase px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="md:col-span-2 space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Address Line 1</label>
                  <input
                    type="text"
                    value={editFormData.addressLine1}
                    onChange={(e) => setEditFormData({ ...editFormData, addressLine1: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">City</label>
                  <input
                    type="text"
                    value={editFormData.city}
                    onChange={(e) => setEditFormData({ ...editFormData, city: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">State</label>
                  <input
                    type="text"
                    value={editFormData.state}
                    onChange={(e) => setEditFormData({ ...editFormData, state: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Credit Limit (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={editFormData.creditLimit}
                    onChange={(e) => setEditFormData({ ...editFormData, creditLimit: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Credit Days</label>
                  <input
                    type="number"
                    min="0"
                    value={editFormData.creditDays}
                    onChange={(e) => setEditFormData({ ...editFormData, creditDays: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Sync Toggle */}
              <div className="pt-3 border-t border-slate-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editFormData.syncToCustomerParty}
                    onChange={(e) => setEditFormData({ ...editFormData, syncToCustomerParty: e.target.checked })}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs font-medium text-slate-700">
                    Synchronize changes to linked Main Customer Party (Party master & credit terms)
                  </span>
                </label>
                <p className="text-[11px] text-slate-400 pl-6 mt-0.5">
                  Does not modify immutable historical transaction vouchers.
                </p>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {editSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DEACTIVATE CONFIRMATION MODAL */}
      {showDeactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3 text-amber-600">
              <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-bold text-slate-900">Deactivate Dealer Company?</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Deactivating will prevent new dealer orders and sales orders for this dealer.
                </p>
              </div>
            </div>

            {deactWarnings?.hasOperationalDependencies && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-900">
                <span className="font-bold block">Active Operational Dependencies:</span>
                <ul className="list-disc pl-5 space-y-1 text-[11px] text-amber-800">
                  {deactWarnings.warnings.map((w: string, idx: number) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeactModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeactivate}
                disabled={deactSubmitting}
                className="px-4 py-2 text-xs font-bold text-white bg-amber-600 rounded-lg hover:bg-amber-700"
              >
                {deactSubmitting ? 'Deactivating...' : 'Confirm Deactivation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE MODAL */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3 text-rose-600">
              <Trash2 className="w-6 h-6 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Empty Dealer</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Permanent deletion is only permitted for dealers with zero transactions, orders, inventory, or user logins.
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteSubmitting}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 rounded-lg hover:bg-rose-700"
              >
                {deleteSubmitting ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
