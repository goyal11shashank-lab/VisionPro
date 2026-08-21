import React, { useState, useEffect } from 'react';
import { Boxes, Plus, Search, RefreshCw, CheckCircle2, XCircle, Edit3, ShieldAlert, Sparkles, Tag } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Base, Category, Coating } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

export const BasesPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [bases, setBases] = useState<Base[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [coatings, setCoatings] = useState<Coating[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editingBase, setEditingBase] = useState<Base | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    family: '',
    coatingId: '',
    description: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    compatibleCategoryIds: [] as string[],
  });
  const [submitting, setSubmitting] = useState<boolean>(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [baseRes, catRes, coatRes] = await Promise.all([
        apiRequest<{ success: boolean; bases: Base[] }>('/api/optical-master/bases'),
        apiRequest<{ success: boolean; categories: Category[] }>('/api/optical-master/categories'),
        apiRequest<{ success: boolean; coatings: Coating[] }>('/api/optical-master/coatings'),
      ]);
      setBases(baseRes.bases || []);
      setCategories(catRes.categories || []);
      setCoatings(coatRes.coatings || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load optical bases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenCreate = () => {
    setEditingBase(null);
    setFormData({
      name: '',
      code: '',
      family: '',
      coatingId: '',
      description: '',
      status: 'ACTIVE',
      compatibleCategoryIds: categories.map(c => c.id), // Default to all compatible
    });
    setShowModal(true);
  };

  const handleOpenEdit = (b: Base) => {
    setEditingBase(b);
    setFormData({
      name: b.name,
      code: b.code,
      family: b.family || '',
      coatingId: b.coatingId || '',
      description: b.description || '',
      status: b.status,
      compatibleCategoryIds: (b.compatibleCategories || []).map(c => c.id),
    });
    setShowModal(true);
  };

  const handleCategoryToggle = (catId: string) => {
    setFormData(prev => {
      const exists = prev.compatibleCategoryIds.includes(catId);
      if (exists) {
        return { ...prev, compatibleCategoryIds: prev.compatibleCategoryIds.filter(id => id !== catId) };
      } else {
        return { ...prev, compatibleCategoryIds: [...prev.compatibleCategoryIds, catId] };
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.compatibleCategoryIds.length === 0) {
      alert('Base must be compatible with at least one Optical Category.');
      return;
    }
    try {
      setSubmitting(true);
      if (editingBase) {
        await apiRequest(`/api/optical-master/bases/${editingBase.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: formData.name,
            family: formData.family,
            coatingId: formData.coatingId || null,
            description: formData.description,
            status: formData.status,
            compatibleCategoryIds: formData.compatibleCategoryIds,
          }),
        });
      } else {
        await apiRequest('/api/optical-master/bases', {
          method: 'POST',
          body: JSON.stringify({
            ...formData,
            coatingId: formData.coatingId || null,
          }),
        });
      }
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Error saving base');
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = bases.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    b.code.toLowerCase().includes(search.toLowerCase()) ||
    (b.family && b.family.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Boxes className="h-7 w-7 text-indigo-600" />
            Bases & Category Compatibility
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Optical lens substrate materials, families, default coatings, and category compatibility mapping.
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
              New Base
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search bases by code (HC, HMC, BCG, PGHC, PCBCG) or family..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
          />
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
                  <th className="px-6 py-4">Base Code</th>
                  <th className="px-6 py-4">Base Name</th>
                  <th className="px-6 py-4">Family</th>
                  <th className="px-6 py-4">Compatible Categories</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                      <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />
                      Loading optical bases & compatibility rules...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                      No optical bases found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4 font-mono">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                          {b.code}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-semibold text-slate-900">
                        {b.name}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {b.family ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                            <Tag className="h-3 w-3" />
                            {b.family}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {b.compatibleCategories && b.compatibleCategories.length > 0 ? (
                            b.compatibleCategories.map(cat => (
                              <span key={cat.id} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                {cat.code}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-amber-600">No categories mapped</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {b.status === 'ACTIVE' ? (
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
                            onClick={() => handleOpenEdit(b)}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                            title="Edit Base"
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
              {editingBase ? `Edit Base: ${editingBase.code}` : 'Create Optical Base'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              {editingBase ? 'Update base details and category compatibility.' : 'Define a new optical substrate base.'}
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Base Code *</label>
                  <input
                    type="text"
                    required
                    disabled={!!editingBase}
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. HC, BCG, PGHC"
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Family Group</label>
                  <input
                    type="text"
                    value={formData.family}
                    onChange={(e) => setFormData({ ...formData, family: e.target.value.toUpperCase() })}
                    placeholder="e.g. CLEAR, BLUE CUT"
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Base Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Clear Hard Multi-Coat"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Default Linked Coating</label>
                <select
                  value={formData.coatingId}
                  onChange={(e) => setFormData({ ...formData, coatingId: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- No Default Coating --</option>
                  {coatings.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Compatible Optical Categories */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Compatible Optical Categories *
                </label>
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  {categories.map(cat => {
                    const isChecked = formData.compatibleCategoryIds.includes(cat.id);
                    return (
                      <label key={cat.id} className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleCategoryToggle(cat.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="font-semibold text-slate-900">{cat.code}</span>
                        <span className="text-slate-500">- {cat.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Substrate specs, index, abbe value..."
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                  {submitting ? 'Saving...' : editingBase ? 'Save Changes' : 'Create Base'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
