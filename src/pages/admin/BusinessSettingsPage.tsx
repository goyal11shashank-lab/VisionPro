import React, { useEffect, useState } from 'react';
import {
  Building2,
  Percent,
  Barcode,
  Save,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  MapPin,
  Mail,
  Phone,
  FileText,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Business } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

interface Props {
  initialTab?: 'general' | 'gst' | 'barcode';
}

export const BusinessSettingsPage: React.FC<Props> = ({ initialTab = 'general' }) => {
  const { currentBusiness, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'general' | 'gst' | 'barcode'>(initialTab);
  const [businessData, setBusinessData] = useState<Partial<Business>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Barcode & GST specific settings
  const [barcodePrefix, setBarcodePrefix] = useState<string>('LUM');
  const [barcodeType, setBarcodeType] = useState<string>('CODE128');
  const [opticalDefaultHsn, setOpticalDefaultHsn] = useState<string>('9003');

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const fetchBusinessDetails = async () => {
    if (!currentBusiness?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest(`/api/businesses/${currentBusiness.id}`);
      setBusinessData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch business profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBusinessDetails();
  }, [currentBusiness?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBusiness?.id) return;

    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiRequest(`/api/businesses/${currentBusiness.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: businessData.name,
          tradeName: businessData.tradeName,
          gstin: businessData.gstin,
          pan: businessData.pan,
          email: businessData.email,
          phone: businessData.phone,
          addressLine1: businessData.addressLine1,
          addressLine2: businessData.addressLine2,
          city: businessData.city,
          state: businessData.state,
          stateCode: businessData.stateCode,
          pincode: businessData.pincode,
          currency: businessData.currency || 'INR',
          financialYearStart: businessData.financialYearStart || '04-01',
        }),
      });

      setSuccessMsg('Business settings successfully saved & recorded in audit trail.');
      await refreshUser();
    } catch (err: any) {
      setError(err.message || 'Failed to update business settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-blue-600" />
            <span>Business Profile & Configuration</span>
          </h2>
          <p className="text-xs text-slate-500">
            Configure enterprise tax details, optical store parameters, GST rates and barcode formats
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-200/80 rounded-xl text-xs font-medium">
          <button
            onClick={() => setActiveTab('general')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'general' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            General Profile
          </button>
          <button
            onClick={() => setActiveTab('gst')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'gst' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            GST & Taxes
          </button>
          <button
            onClick={() => setActiveTab('barcode')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'barcode' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Barcode Format
          </button>
        </div>
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

      {loading ? (
        <div className="p-12 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
          Loading business configuration from PostgreSQL...
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          {/* General Tab */}
          {activeTab === 'general' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-semibold text-slate-900">Legal Business Identity</h3>
                <p className="text-xs text-slate-500">Official registered business and contact information</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Legal Company Name *</label>
                  <input
                    type="text"
                    required
                    value={businessData.name || ''}
                    onChange={(e) => setBusinessData({ ...businessData, name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Trade / Display Name</label>
                  <input
                    type="text"
                    value={businessData.tradeName || ''}
                    onChange={(e) => setBusinessData({ ...businessData, tradeName: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Base Currency</label>
                  <select
                    value={businessData.currency || 'INR'}
                    onChange={(e) => setBusinessData({ ...businessData, currency: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="INR">INR (₹ - Indian Rupee)</option>
                    <option value="USD">USD ($ - US Dollar)</option>
                    <option value="EUR">EUR (€ - Euro)</option>
                    <option value="GBP">GBP (£ - British Pound)</option>
                    <option value="AED">AED (د.إ - UAE Dirham)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Official Email</label>
                  <div className="relative">
                    <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      value={businessData.email || ''}
                      onChange={(e) => setBusinessData({ ...businessData, email: e.target.value })}
                      className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Official Phone / Mobile</label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="tel"
                      value={businessData.phone || ''}
                      onChange={(e) => setBusinessData({ ...businessData, phone: e.target.value })}
                      className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Financial Year Start</label>
                  <input
                    type="text"
                    value={businessData.financialYearStart || '04-01'}
                    onChange={(e) => setBusinessData({ ...businessData, financialYearStart: e.target.value })}
                    placeholder="MM-DD (e.g. 04-01)"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h4 className="text-xs font-bold uppercase text-slate-700 mb-3 tracking-wider flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-blue-600" />
                  <span>Physical Store / Billing Address</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                  <div className="sm:col-span-2 space-y-1">
                    <label className="font-semibold text-slate-700">Address Line 1</label>
                    <input
                      type="text"
                      value={businessData.addressLine1 || ''}
                      onChange={(e) => setBusinessData({ ...businessData, addressLine1: e.target.value })}
                      placeholder="Shop/Unit No., Building name, Street"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="sm:col-span-2 space-y-1">
                    <label className="font-semibold text-slate-700">Address Line 2</label>
                    <input
                      type="text"
                      value={businessData.addressLine2 || ''}
                      onChange={(e) => setBusinessData({ ...businessData, addressLine2: e.target.value })}
                      placeholder="Area, Landmark"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">City</label>
                    <input
                      type="text"
                      value={businessData.city || ''}
                      onChange={(e) => setBusinessData({ ...businessData, city: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">State</label>
                    <input
                      type="text"
                      value={businessData.state || ''}
                      onChange={(e) => setBusinessData({ ...businessData, state: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">State Code (GST)</label>
                    <input
                      type="text"
                      value={businessData.stateCode || ''}
                      onChange={(e) => setBusinessData({ ...businessData, stateCode: e.target.value })}
                      placeholder="e.g. 27"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Pincode</label>
                    <input
                      type="text"
                      value={businessData.pincode || ''}
                      onChange={(e) => setBusinessData({ ...businessData, pincode: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* GST & Taxes Tab */}
          {activeTab === 'gst' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-semibold text-slate-900">Goods and Services Tax (GST) Settings</h3>
                <p className="text-xs text-slate-500">Tax compliance parameters and standard optical HSN codes</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">GSTIN Number (15 Digits)</label>
                  <input
                    type="text"
                    maxLength={15}
                    value={businessData.gstin || ''}
                    onChange={(e) => setBusinessData({ ...businessData, gstin: e.target.value.toUpperCase() })}
                    placeholder="e.g. 27AABCL1234F1Z8"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Income Tax PAN Number</label>
                  <input
                    type="text"
                    maxLength={10}
                    value={businessData.pan || ''}
                    onChange={(e) => setBusinessData({ ...businessData, pan: e.target.value.toUpperCase() })}
                    placeholder="e.g. AABCL1234F"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Default Frame HSN</label>
                  <input
                    type="text"
                    value={opticalDefaultHsn}
                    onChange={(e) => setOpticalDefaultHsn(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Standard Optical GST Slabs reference */}
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <h4 className="text-xs font-bold uppercase text-slate-700 tracking-wider">
                  Optical Industry Standard GST Slabs Reference
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="font-semibold text-slate-900">Spectacle Frames (HSN 9003)</span>
                    <p className="text-[11px] text-blue-600 font-bold mt-1">12% GST (6% CGST + 6% SGST)</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="font-semibold text-slate-900">Ophthalmic Lenses (HSN 9001)</span>
                    <p className="text-[11px] text-blue-600 font-bold mt-1">12% GST (6% CGST + 6% SGST)</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="font-semibold text-slate-900">Contact Lenses & Care (9001)</span>
                    <p className="text-[11px] text-blue-600 font-bold mt-1">12% GST (6% CGST + 6% SGST)</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="font-semibold text-slate-900">Sunglasses (HSN 9004)</span>
                    <p className="text-[11px] text-purple-600 font-bold mt-1">18% GST (9% CGST + 9% SGST)</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Barcode Tab */}
          {activeTab === 'barcode' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-semibold text-slate-900">Barcode Generation & Label Settings</h3>
                <p className="text-xs text-slate-500">Configure frame and lens batch barcode format for thermal label printers</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Barcode Tag Prefix</label>
                  <input
                    type="text"
                    value={barcodePrefix}
                    onChange={(e) => setBarcodePrefix(e.target.value.toUpperCase())}
                    placeholder="e.g. LUM"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Barcode Symbology</label>
                  <select
                    value={barcodeType}
                    onChange={(e) => setBarcodeType(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="CODE128">Code 128 (Standard Optical Tags)</option>
                    <option value="EAN13">EAN-13 (Standard Retail Barcode)</option>
                    <option value="QR">2D QR Code</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Label Print Format</label>
                  <select className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="50x25">50mm x 25mm (Standard Butterfly Tag)</option>
                    <option value="38x25">38mm x 25mm (Dual Dumbbell Tag)</option>
                    <option value="roll">Continuous Thermal Roll</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Action Bar */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-md shadow-blue-600/20 transition-all flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Saving Settings...' : 'Save Configuration'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
