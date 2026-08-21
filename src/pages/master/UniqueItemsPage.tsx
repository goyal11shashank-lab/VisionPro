import React, { useState, useEffect } from 'react';
import { QrCode, Plus, Search, RefreshCw, CheckCircle2, XCircle, Edit3, ShieldAlert, Filter, IndianRupee, Layers } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { UniqueItem, PrimaryItem } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

export const UniqueItemsPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [uniqueItems, setUniqueItems] = useState<UniqueItem[]>([]);
  const [primaryItems, setPrimaryItems] = useState<PrimaryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');
  const [selectedPrimaryItem, setSelectedPrimaryItem] = useState<string>('');
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<UniqueItem | null>(null);
  const [formData, setFormData] = useState({
    primaryItemId: '',
    name: '',
    code: '',
    description: '',
    purchaseRate: 0,
    lastPurchasePrice: 0,
    mrp: 0,
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });
  const [submitting, setSubmitting] = useState<boolean>(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [uRes, pRes] = await Promise.all([
        apiRequest<{ success: boolean; uniqueItems: UniqueItem[] }>('/api/optical-master/unique-items'),
        apiRequest<{ success: boolean; primaryItems: PrimaryItem[] }>('/api/optical-master/primary-items'),
      ]);
      setUniqueItems(uRes.uniqueItems || []);
      setPrimaryItems(pRes.primaryItems || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load unique items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenCreate = () => {
    setEditingItem(null);
    const defaultP = primaryItems[0]?.id || '';
    setFormData({
      primaryItemId: defaultP,
      name: '',
      code: '',
      description: '',
      purchaseRate: 0,
      lastPurchasePrice: 0,
      mrp: 0,
      status: 'ACTIVE',
    });
    setShowModal(true);
  };

  const handleOpenEdit = (item: UniqueItem) => {
    setEditingItem(item);
    setFormData({
      primaryItemId: item.primaryItemId,
      name: item.name,
      code: item.code,
      description: item.description || '',
      purchaseRate: Number(item.purchaseRate) || 0,
      lastPurchasePrice: Number(item.lastPurchasePrice) || 0,
      mrp: Number(item.mrp) || 0,
      status: item.status,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      if (editingItem) {
        await apiRequest(`/api/optical-master/unique-items/${editingItem.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: formData.name,
            description: formData.description,
            purchaseRate: formData.purchaseRate,
            lastPurchasePrice: formData.lastPurchasePrice,
            mrp: formData.mrp,
            status: formData.status,
          }),
        });
      } else {
        await apiRequest('/api/optical-master/unique-items', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
      }
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Error saving unique item');
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = uniqueItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.code.toLowerCase().includes(search.toLowerCase()) ||
      (item.primaryItemName && item.primaryItemName.toLowerCase().includes(search.toLowerCase()));
    const matchesPrimary = selectedPrimaryItem ? item.primaryItemId === selectedPrimaryItem : true;
    return matchesSearch && matchesPrimary;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <QrCode className="h-7 w-7 text-indigo-600" />
            Unique Items Master
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            SKU level products with distinct commercial pricing, brand packaging, and purchase rates.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {hasPermission('master:create') && (
            <button
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-xs"
            >
              <Plus className="h-4 w-4" />
              New Unique Item
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search unique items by code, name, or primary item..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={selectedPrimaryItem}
            onChange={(e) => setSelectedPrimaryItem(e.target.value)}
            className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-xs truncate"
          >
            <option value="">All Primary Items</option>
            {primaryItems.map(p => (
              <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />
          {error}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4">SKU Code</th>
                  <th className="px-6 py-4">Unique Item Name</th>
                  <th className="px-6 py-4">Primary Item</th>
                  <th className="px-6 py-4">Category</th>
                  <th className="px-6 py-4">Purchase Rate</th>
                  <th className="px-6 py-4">MRP</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                      <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />
                      Loading unique item catalog...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                      No unique items found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4 font-mono">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {item.code}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-semibold text-slate-900">
                        {item.name}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {item.primaryItemName || item.primaryItemCode || '—'}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          {item.categoryCode || 'SV'}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-900">
                        ₹{Number(item.purchaseRate).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-900">
                        ₹{Number(item.mrp).toFixed(2)}
                      </td>
                      <td className="px-6 py-4">
                        {item.status === 'ACTIVE' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                            <XCircle className="h-3.5 w-3.5" />
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {hasPermission('master:edit') && (
                          <button
                            onClick={() => handleOpenEdit(item)}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                            title="Edit Unique Item"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              {editingItem ? `Edit Unique Item: ${editingItem.code}` : 'Create Unique Item (SKU)'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              {editingItem ? 'Update unique packaging and commercial rates.' : 'Add a distinct brand SKU under a Primary Item.'}
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Parent Primary Item *</label>
                <select
                  required
                  disabled={!!editingItem}
                  value={formData.primaryItemId}
                  onChange={(e) => setFormData({ ...formData, primaryItemId: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  <option value="">Select Primary Item</option>
                  {primaryItems.map(p => (
                    <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Unique SKU Code *</label>
                  <input
                    type="text"
                    required
                    disabled={!!editingItem}
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. PGHC_KT_STD"
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as 'ACTIVE' | 'INACTIVE' })}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Unique Item Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. PG HC KT - Standard White Box"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Purchase Rate (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.purchaseRate}
                    onChange={(e) => setFormData({ ...formData, purchaseRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Last Purch. Price (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.lastPurchasePrice}
                    onChange={(e) => setFormData({ ...formData, lastPurchasePrice: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">MRP (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.mrp}
                    onChange={(e) => setFormData({ ...formData, mrp: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Packaging details, brand label, supplier info..."
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingItem ? 'Save Changes' : 'Create Unique Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
