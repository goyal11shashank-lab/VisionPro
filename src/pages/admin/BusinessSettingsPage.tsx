import React, { useEffect, useState, useMemo } from 'react';
import {
  Building2,
  Users,
  Package,
  Layers,
  ShoppingBag,
  ShoppingCart,
  ClipboardList,
  Percent,
  Hash,
  Printer,
  SlidersHorizontal,
  ShieldAlert,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Search,
  Check,
  HelpCircle,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';
import { useBusinessSettings } from '../../context/SettingsContext.js';
import { AppSettings, DEFAULT_APP_SETTINGS } from '../../types/settings.js';

interface Props {
  initialTab?: string;
}

interface SettingGroupMeta {
  id: string;
  name: string;
  icon: React.ElementType;
  description: string;
  count: number;
}

export const BusinessSettingsPage: React.FC<Props> = ({ initialTab = 'general' }) => {
  const { currentBusiness, refreshUser } = useAuth();
  const {
    settings: globalSettings,
    lowStockThreshold: globalThreshold,
    updateSettings,
    restoreDefaults,
    loading: contextLoading,
  } = useBusinessSettings();

  // Normalize initial tab
  const getNormalizedTab = (tab: string): string => {
    const map: Record<string, string> = {
      general: 'general',
      gst: 'gst',
      barcode: 'stockItem',
      parties: 'party',
      inventory: 'inventory',
      sales: 'sales',
      purchase: 'purchase',
      orders: 'orders',
      voucher: 'voucher',
      print: 'print',
      display: 'display',
      advanced: 'advanced',
    };
    return map[tab] || tab || 'general';
  };

  const [activeTab, setActiveTab] = useState<string>(getNormalizedTab(initialTab));
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Local form state cloned from global settings
  const [formData, setFormData] = useState<AppSettings>(globalSettings);
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(globalThreshold);

  // Business legal entity state
  const [bizInfo, setBizInfo] = useState({
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
  });

  const [saving, setSaving] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState<boolean>(false);

  useEffect(() => {
    if (globalSettings) {
      setFormData(globalSettings);
    }
    if (globalThreshold !== undefined) {
      setLowStockThreshold(globalThreshold);
    }
  }, [globalSettings, globalThreshold]);

  useEffect(() => {
    setActiveTab(getNormalizedTab(initialTab));
  }, [initialTab]);

  // Load business master details for General tab
  useEffect(() => {
    if (!currentBusiness?.id) return;
    apiRequest(`/api/businesses/${currentBusiness.id}`)
      .then((data: any) => {
        if (data) {
          setBizInfo({
            name: data.name || '',
            tradeName: data.tradeName || '',
            gstin: data.gstin || '',
            pan: data.pan || '',
            email: data.email || '',
            phone: data.phone || '',
            addressLine1: data.addressLine1 || '',
            addressLine2: data.addressLine2 || '',
            city: data.city || '',
            state: data.state || '',
            stateCode: data.stateCode || '',
            pincode: data.pincode || '',
          });
        }
      })
      .catch((err) => console.error('Failed to load business profile', err));
  }, [currentBusiness?.id]);

  // Group definitions
  const settingGroups: SettingGroupMeta[] = [
    {
      id: 'general',
      name: 'General & Profile',
      icon: Building2,
      description: 'Business legal entity, financial year and books beginning dates',
      count: 10,
    },
    {
      id: 'party',
      name: 'Party Settings',
      icon: Users,
      description: 'Customer credit limits, duplicate validation, and ledger enforcement',
      count: 5,
    },
    {
      id: 'stockItem',
      name: 'Stock Item Settings',
      icon: Package,
      description: 'Optical prescription mandatory flags, barcode symbology, and prefixes',
      count: 6,
    },
    {
      id: 'inventory',
      name: 'Inventory & Stock',
      icon: Layers,
      description: 'Negative stock policy, low stock alerts, and sales order reservations',
      count: 6,
    },
    {
      id: 'sales',
      name: 'Sales & Billing',
      icon: ShoppingBag,
      description: 'Discounts, round-off modes, salesperson assignments, and auto-print',
      count: 8,
    },
    {
      id: 'purchase',
      name: 'Purchase Settings',
      icon: ShoppingCart,
      description: 'Supplier credit period, price change alerts, and costing behavior',
      count: 4,
    },
    {
      id: 'orders',
      name: 'Order Lifecycle',
      icon: ClipboardList,
      description: 'Order validity limits, status notifications, and module toggles',
      count: 4,
    },
    {
      id: 'gst',
      name: 'GST & Compliance',
      icon: Percent,
      description: 'Default tax rates, optical HSN code, RCM, and composition rules',
      count: 6,
    },
    {
      id: 'voucher',
      name: 'Voucher & Numbering',
      icon: Hash,
      description: 'Prefixes, starting sequence numbers, and voucher narration rules',
      count: 9,
    },
    {
      id: 'print',
      name: 'Print & Layout',
      icon: Printer,
      description: 'Tax invoice header titles, terms, authorized signatory, and copies',
      count: 11,
    },
    {
      id: 'display',
      name: 'Display & Behavior',
      icon: SlidersHorizontal,
      description: 'Date format, table density, badges, and quick keyboard shortcuts',
      count: 5,
    },
    {
      id: 'advanced',
      name: 'Control & Security',
      icon: ShieldAlert,
      description: 'Backdated entry limits, cancellation remarks, and audit trail options',
      count: 5,
    },
  ];

  // Helper for updating nested formData
  const handleUpdate = <K extends keyof AppSettings>(
    group: K,
    key: keyof AppSettings[K],
    value: any
  ) => {
    setFormData((prev) => ({
      ...prev,
      [group]: {
        ...prev[group],
        [key]: value,
      },
    }));
  };

  // Helper for voucher numbering updates
  const handleVoucherNumbering = (
    voucherType: keyof AppSettings['voucher']['numbering'],
    field: 'prefix' | 'startNumber' | 'method',
    value: any
  ) => {
    setFormData((prev) => ({
      ...prev,
      voucher: {
        ...prev.voucher,
        numbering: {
          ...prev.voucher.numbering,
          [voucherType]: {
            ...prev.voucher.numbering[voucherType],
            [field]: value,
          },
        },
      },
    }));
  };

  const handleSaveAll = async () => {
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // 1. Update business legal details if modified
      if (currentBusiness?.id) {
        await apiRequest(`/api/businesses/${currentBusiness.id}`, {
          method: 'PUT',
          body: JSON.stringify(bizInfo),
        });
      }

      // 2. Update all application settings
      const ok = await updateSettings(formData, lowStockThreshold);
      if (ok) {
        setSuccessMsg('Settings updated successfully! Changes are active immediately.');
        if (refreshUser) refreshUser();
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        throw new Error('Failed to save settings to server');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefaultsConfirm = async () => {
    setShowRestoreModal(false);
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const ok = await restoreDefaults();
      if (ok) {
        setFormData(DEFAULT_APP_SETTINGS);
        setLowStockThreshold(1.0);
        setSuccessMsg('Settings have been restored to recommended defaults.');
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        throw new Error('Failed to restore defaults');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to restore default settings');
    } finally {
      setSaving(false);
    }
  };

  // Filter groups based on search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return settingGroups;
    const q = searchQuery.toLowerCase();
    return settingGroups.filter(
      (g) => g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16 font-sans">
      {/* Header & Sticky Action Bar */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-xs px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Application Settings</h1>
              <span className="px-2 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 rounded border border-blue-200">
                12 Modules
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure accounting rules, validation strictness, print styling, and operational defaults
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Search Box */}
            <div className="relative w-48 sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                id="input-settings-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search settings..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-100 text-slate-900 border border-slate-200 rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Restore Defaults Button */}
            <button
              id="btn-restore-recommended-defaults"
              type="button"
              onClick={() => setShowRestoreModal(true)}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              <span>Restore Defaults</span>
            </button>

            {/* Save Button */}
            <button
              id="btn-save-all-settings"
              type="button"
              onClick={handleSaveAll}
              disabled={saving}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </div>
        </div>

        {/* Notifications */}
        {successMsg && (
          <div
            id="notification-settings-success"
            className="max-w-7xl mx-auto mt-3 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div
            id="notification-settings-error"
            className="max-w-7xl mx-auto mt-3 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-medium">{errorMsg}</span>
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-6 mt-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Navigation Tabs */}
          <div className="lg:col-span-1 space-y-1">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-3 py-1">
              Settings Groups
            </div>
            {filteredGroups.map((group) => {
              const Icon = group.icon;
              const isActive = activeTab === group.id;
              return (
                <button
                  key={group.id}
                  id={`tab-settings-group-${group.id}`}
                  onClick={() => setActiveTab(group.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-left transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600 shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate">{group.name}</div>
                    <div className="text-[10px] text-slate-400 truncate">{group.description}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Content Panels */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-6">
              {/* Group 1: General Settings */}
              {activeTab === 'general' && (
                <div id="section-settings-general" className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-base font-bold text-slate-900">General & Legal Profile</h2>
                    <p className="text-xs text-slate-500">Legal entity information and base accounting rules</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Company / Store Name</label>
                      <input
                        id="input-biz-name"
                        type="text"
                        value={bizInfo.name}
                        onChange={(e) => setBizInfo({ ...bizInfo, name: e.target.value })}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Trade Name / Brand</label>
                      <input
                        id="input-biz-trade-name"
                        type="text"
                        value={bizInfo.tradeName}
                        onChange={(e) => setBizInfo({ ...bizInfo, tradeName: e.target.value })}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">GSTIN</label>
                      <input
                        id="input-biz-gstin"
                        type="text"
                        value={bizInfo.gstin}
                        onChange={(e) => setBizInfo({ ...bizInfo, gstin: e.target.value.toUpperCase() })}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded font-mono uppercase focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">PAN Number</label>
                      <input
                        id="input-biz-pan"
                        type="text"
                        value={bizInfo.pan}
                        onChange={(e) => setBizInfo({ ...bizInfo, pan: e.target.value.toUpperCase() })}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded font-mono uppercase focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Primary Email</label>
                      <input
                        id="input-biz-email"
                        type="email"
                        value={bizInfo.email}
                        onChange={(e) => setBizInfo({ ...bizInfo, email: e.target.value })}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
                      <input
                        id="input-biz-phone"
                        type="text"
                        value={bizInfo.phone}
                        onChange={(e) => setBizInfo({ ...bizInfo, phone: e.target.value })}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Address Line 1</label>
                      <input
                        id="input-biz-address-1"
                        type="text"
                        value={bizInfo.addressLine1}
                        onChange={(e) => setBizInfo({ ...bizInfo, addressLine1: e.target.value })}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
                      <input
                        id="input-biz-city"
                        type="text"
                        value={bizInfo.city}
                        onChange={(e) => setBizInfo({ ...bizInfo, city: e.target.value })}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">State</label>
                      <input
                        id="input-biz-state"
                        type="text"
                        value={bizInfo.state}
                        onChange={(e) => setBizInfo({ ...bizInfo, state: e.target.value })}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
                      Currency & Fiscal Period
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Currency Symbol</label>
                        <input
                          id="input-general-currency-symbol"
                          type="text"
                          value={formData.general.currencySymbol}
                          onChange={(e) => handleUpdate('general', 'currencySymbol', e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Decimal Places</label>
                        <select
                          id="select-general-decimal-places"
                          value={formData.general.decimalPlaces}
                          onChange={(e) => handleUpdate('general', 'decimalPlaces', parseInt(e.target.value, 10))}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white"
                        >
                          <option value="2">2 Decimal Places (0.00)</option>
                          <option value="3">3 Decimal Places (0.000)</option>
                          <option value="4">4 Decimal Places (0.0000)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Financial Year Begins</label>
                        <input
                          id="input-general-fy-beginning"
                          type="date"
                          value={formData.general.financialYearBeginning}
                          onChange={(e) => handleUpdate('general', 'financialYearBeginning', e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Group 2: Party Settings */}
              {activeTab === 'party' && (
                <div id="section-settings-party" className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-base font-bold text-slate-900">Party & Customer Settings</h2>
                    <p className="text-xs text-slate-500">
                      Credit limit validation, duplicate checks, and default place of supply
                    </p>
                  </div>

                  <div className="space-y-4">
                    {/* Credit Limit Action */}
                    <div className="p-4 bg-slate-50 rounded border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold text-slate-900">Customer Credit Limit Enforcement</div>
                        <div className="text-[11px] text-slate-500">
                          Configure how vouchers behave when a customer's total outstanding exceeds their credit limit
                        </div>
                      </div>
                      <select
                        id="select-party-credit-limit-action"
                        value={formData.party.creditLimitAction}
                        onChange={(e) => handleUpdate('party', 'creditLimitAction', e.target.value)}
                        className="px-3 py-1.5 text-xs border border-slate-300 rounded bg-white font-semibold text-slate-800"
                      >
                        <option value="WARNING">Warning Only (Allow Sale)</option>
                        <option value="BLOCK">Strict Block (Prevent Sale)</option>
                        <option value="OFF">Disabled (No Check)</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Default Customer Credit Limit (₹)
                        </label>
                        <input
                          id="input-party-default-credit-limit"
                          type="number"
                          value={formData.party.defaultCustomerCreditLimit}
                          onChange={(e) =>
                            handleUpdate('party', 'defaultCustomerCreditLimit', parseFloat(e.target.value) || 0)
                          }
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Default Place of Supply / State
                        </label>
                        <input
                          id="input-party-default-state"
                          type="text"
                          value={formData.party.defaultState}
                          onChange={(e) => handleUpdate('party', 'defaultState', e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                          placeholder="e.g. Maharashtra"
                        />
                      </div>
                    </div>

                    <div className="pt-2 space-y-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          id="toggle-party-unique-gstin"
                          type="checkbox"
                          checked={formData.party.enforceUniqueGstin}
                          onChange={(e) => handleUpdate('party', 'enforceUniqueGstin', e.target.checked)}
                          className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                        />
                        <span className="text-xs text-slate-800 font-medium">
                          Enforce Unique GSTIN across all customer and supplier records
                        </span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          id="toggle-party-unique-phone"
                          type="checkbox"
                          checked={formData.party.enforceUniquePhone}
                          onChange={(e) => handleUpdate('party', 'enforceUniquePhone', e.target.checked)}
                          className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                        />
                        <span className="text-xs text-slate-800 font-medium">
                          Warn on duplicate phone numbers when creating or editing parties
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Group 3: Stock Item Settings */}
              {activeTab === 'stockItem' && (
                <div id="section-settings-stock-item" className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-base font-bold text-slate-900">Stock Item & Barcode Settings</h2>
                    <p className="text-xs text-slate-500">Optical item defaults, prescription rules, and labeling</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Default Barcode Prefix
                      </label>
                      <input
                        id="input-stock-barcode-prefix"
                        type="text"
                        value={formData.stockItem.defaultBarcodePrefix}
                        onChange={(e) =>
                          handleUpdate('stockItem', 'defaultBarcodePrefix', e.target.value.toUpperCase())
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded font-mono uppercase focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Barcode Symbology / Format
                      </label>
                      <select
                        id="select-stock-barcode-symbology"
                        value={formData.stockItem.barcodeSymbology}
                        onChange={(e) => handleUpdate('stockItem', 'barcodeSymbology', e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="CODE128">Code 128 (Standard Optical Industry Barcode)</option>
                        <option value="EAN13">EAN-13 (Standard Retail Barcode)</option>
                        <option value="QR">QR Code (High Density 2D Code)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Default Lens Coating</label>
                      <input
                        id="input-stock-default-coating"
                        type="text"
                        value={formData.stockItem.defaultLensCoating}
                        onChange={(e) => handleUpdate('stockItem', 'defaultLensCoating', e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Default Base Material</label>
                      <input
                        id="input-stock-default-base"
                        type="text"
                        value={formData.stockItem.defaultBaseMaterial}
                        onChange={(e) => handleUpdate('stockItem', 'defaultBaseMaterial', e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-2 space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-stock-auto-barcode"
                        type="checkbox"
                        checked={formData.stockItem.autoGenerateItemBarcode}
                        onChange={(e) => handleUpdate('stockItem', 'autoGenerateItemBarcode', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Auto-generate unique optical batch barcode during purchase receipt if empty
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-stock-prescription-mandatory"
                        type="checkbox"
                        checked={formData.stockItem.opticalPrescriptionMandatory}
                        onChange={(e) => handleUpdate('stockItem', 'opticalPrescriptionMandatory', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Require SPH / CYL optical power specifications when creating optical lens batches
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Group 4: Inventory & Stock Settings */}
              {activeTab === 'inventory' && (
                <div id="section-settings-inventory" className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-base font-bold text-slate-900">Inventory & Stock Rules</h2>
                    <p className="text-xs text-slate-500">
                      Negative inventory allowance, reservation holds, and alert thresholds
                    </p>
                  </div>

                  {/* Allow Negative Stock Box */}
                  <div className="p-4 bg-slate-50 rounded border border-slate-200 space-y-2">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        id="toggle-inventory-allow-negative-stock"
                        type="checkbox"
                        checked={formData.inventory.allowNegativeStock}
                        onChange={(e) => handleUpdate('inventory', 'allowNegativeStock', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 mt-0.5 focus:ring-blue-500"
                      />
                      <div>
                        <div className="text-xs font-bold text-slate-900">Allow Negative Stock Transactions</div>
                        <div className="text-[11px] text-slate-500 leading-relaxed">
                          When checked, sales invoices can be posted even if physical batch stock is insufficient
                          (stock quantity will drop below zero). When unchecked, sales invoices that exceed available stock
                          will be blocked.
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Low Stock Alert Warning Threshold (Units)
                      </label>
                      <input
                        id="input-inventory-low-stock-threshold"
                        type="number"
                        step="0.5"
                        value={lowStockThreshold}
                        onChange={(e) => setLowStockThreshold(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-400">
                        Batches with stock below this number are flagged with a low stock badge
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Sales Order Reservation Expiry (Days)
                      </label>
                      <input
                        id="input-inventory-reservation-expiry-days"
                        type="number"
                        value={formData.inventory.reservationExpiryDays}
                        onChange={(e) =>
                          handleUpdate('inventory', 'reservationExpiryDays', parseInt(e.target.value, 10) || 7)
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-2 space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-inventory-reserve-on-sales-order"
                        type="checkbox"
                        checked={formData.inventory.reserveStockOnSalesOrder}
                        onChange={(e) => handleUpdate('inventory', 'reserveStockOnSalesOrder', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Automatically hold and reserve physical batch stock when a Sales Order is confirmed
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-inventory-allow-order-beyond-available"
                        type="checkbox"
                        checked={formData.inventory.allowOrderBeyondAvailable}
                        onChange={(e) => handleUpdate('inventory', 'allowOrderBeyondAvailable', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Allow booking Sales Orders beyond currently available stock (backorders allowed)
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-inventory-auto-release-expired"
                        type="checkbox"
                        checked={formData.inventory.autoReleaseExpiredReservations}
                        onChange={(e) => handleUpdate('inventory', 'autoReleaseExpiredReservations', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Auto-release reserved stock after validity period if order is not converted to invoice
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Group 5: Sales & Billing Settings */}
              {activeTab === 'sales' && (
                <div id="section-settings-sales" className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-base font-bold text-slate-900">Sales & Billing Options</h2>
                    <p className="text-xs text-slate-500">
                      Discounts, round-off calculations, auto-print, and salesperson enforcement
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Default GST Mode</label>
                      <select
                        id="select-sales-gst-mode"
                        value={formData.sales.defaultGstMode}
                        onChange={(e) => handleUpdate('sales', 'defaultGstMode', e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="INTRA_STATE">Intra-State (CGST + SGST)</option>
                        <option value="INTER_STATE">Inter-State (IGST)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Default Discount Mode</label>
                      <select
                        id="select-sales-discount-type"
                        value={formData.sales.defaultDiscountType}
                        onChange={(e) => handleUpdate('sales', 'defaultDiscountType', e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="PERCENTAGE">Percentage (%) Discount</option>
                        <option value="FIXED">Fixed Amount (₹) Discount</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Maximum Allowed Discount (%)
                      </label>
                      <input
                        id="input-sales-max-discount"
                        type="number"
                        value={formData.sales.maxDiscountPercentage}
                        onChange={(e) =>
                          handleUpdate('sales', 'maxDiscountPercentage', parseFloat(e.target.value) || 0)
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Round-Off Calculation</label>
                      <select
                        id="select-sales-round-off-mode"
                        value={formData.sales.roundOffMode}
                        onChange={(e) => handleUpdate('sales', 'roundOffMode', e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="NEAREST_RUPEE">Nearest Rupee (Mathematical Rounding)</option>
                        <option value="NONE">Exact Paise (No Rounding)</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-2 space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-sales-allow-discount"
                        type="checkbox"
                        checked={formData.sales.allowDiscount}
                        onChange={(e) => handleUpdate('sales', 'allowDiscount', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Enable item and invoice discount fields in Sales Voucher
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-sales-enable-round-off"
                        type="checkbox"
                        checked={formData.sales.enableRoundOff}
                        onChange={(e) => handleUpdate('sales', 'enableRoundOff', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Enable automatic round-off adjustment ledger on final invoice total
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-sales-require-salesperson"
                        type="checkbox"
                        checked={formData.sales.requireSalesperson}
                        onChange={(e) => handleUpdate('sales', 'requireSalesperson', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Mandate Salesperson / Optometrist assignment before saving invoice
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-sales-auto-print"
                        type="checkbox"
                        checked={formData.sales.autoPrintOnSave}
                        onChange={(e) => handleUpdate('sales', 'autoPrintOnSave', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Automatically pop open print preview dialog immediately upon posting a sales invoice
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Group 6: Purchase Settings */}
              {activeTab === 'purchase' && (
                <div id="section-settings-purchase" className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-base font-bold text-slate-900">Purchase & Supplier Rules</h2>
                    <p className="text-xs text-slate-500">
                      Inward procurement tax modes, credit cycles, and price alerts
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Default Purchase GST Mode
                      </label>
                      <select
                        id="select-purchase-gst-mode"
                        value={formData.purchase.defaultGstMode}
                        onChange={(e) => handleUpdate('purchase', 'defaultGstMode', e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="INTRA_STATE">Intra-State Purchase (CGST + SGST)</option>
                        <option value="INTER_STATE">Inter-State Purchase (IGST)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Default Supplier Credit Period (Days)
                      </label>
                      <input
                        id="input-purchase-credit-period"
                        type="number"
                        value={formData.purchase.defaultCreditPeriodDays}
                        onChange={(e) =>
                          handleUpdate('purchase', 'defaultCreditPeriodDays', parseInt(e.target.value, 10) || 30)
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-2 space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-purchase-update-cost-price"
                        type="checkbox"
                        checked={formData.purchase.updateCostPriceFromPurchase}
                        onChange={(e) => handleUpdate('purchase', 'updateCostPriceFromPurchase', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Update standard purchase cost price in item master based on latest purchase invoice rate
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-purchase-warn-higher-rate"
                        type="checkbox"
                        checked={formData.purchase.warnOnHigherPurchaseRate}
                        onChange={(e) => handleUpdate('purchase', 'warnOnHigherPurchaseRate', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Warn user if purchase line rate exceeds previous inward rate for the same batch
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Group 7: Order Settings */}
              {activeTab === 'orders' && (
                <div id="section-settings-orders" className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-base font-bold text-slate-900">Order Management & Lifecycle</h2>
                    <p className="text-xs text-slate-500">
                      Enable/disable sales & purchase orders, set validity limits, and alerts
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Default Order Validity (Days)
                      </label>
                      <input
                        id="input-orders-validity-days"
                        type="number"
                        value={formData.orders.defaultOrderValidityDays}
                        onChange={(e) =>
                          handleUpdate('orders', 'defaultOrderValidityDays', parseInt(e.target.value, 10) || 15)
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-2 space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-orders-enable-sales-orders"
                        type="checkbox"
                        checked={formData.orders.enableSalesOrders}
                        onChange={(e) => handleUpdate('orders', 'enableSalesOrders', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Enable Sales Orders module (with advance bookings and customer reservations)
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-orders-enable-purchase-orders"
                        type="checkbox"
                        checked={formData.orders.enablePurchaseOrders}
                        onChange={(e) => handleUpdate('orders', 'enablePurchaseOrders', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Enable Purchase Orders module (for placing advance purchase indent orders to suppliers)
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-orders-notify-customer"
                        type="checkbox"
                        checked={formData.orders.notifyCustomerOnStatusChange}
                        onChange={(e) => handleUpdate('orders', 'notifyCustomerOnStatusChange', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Notify customer via SMS / WhatsApp on order status transitions (Ready, Delivered)
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Group 8: GST & Tax Settings */}
              {activeTab === 'gst' && (
                <div id="section-settings-gst" className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-base font-bold text-slate-900">GST Compliance & Tax Rules</h2>
                    <p className="text-xs text-slate-500">
                      Standard tax rates, optical HSN code, reverse charge, and invoice breakdown
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Default Optical GST Rate (%)
                      </label>
                      <select
                        id="select-gst-default-rate"
                        value={formData.gst.defaultGstRate}
                        onChange={(e) => handleUpdate('gst', 'defaultGstRate', parseFloat(e.target.value))}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="0">0% (Nil / Exempted)</option>
                        <option value="5">5% (Standard Optical Prescription Lenses & Frames)</option>
                        <option value="12">12% (Contact Lens Solutions & Accessories)</option>
                        <option value="18">18% (Sunglasses & Luxury Frames)</option>
                        <option value="28">28% (High Tax Category)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Default Optical HSN / SAC Code
                      </label>
                      <input
                        id="input-gst-default-hsn"
                        type="text"
                        value={formData.gst.defaultOpticalHsn}
                        onChange={(e) => handleUpdate('gst', 'defaultOpticalHsn', e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none"
                        placeholder="e.g. 9003"
                      />
                    </div>
                  </div>

                  <div className="pt-2 space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-gst-is-registered"
                        type="checkbox"
                        checked={formData.gst.isGstRegistered}
                        onChange={(e) => handleUpdate('gst', 'isGstRegistered', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Business is registered under Goods and Services Tax (GST) Act
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-gst-composition"
                        type="checkbox"
                        checked={formData.gst.compositionScheme}
                        onChange={(e) => handleUpdate('gst', 'compositionScheme', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Composition Scheme Dealer (No tax charged from customer on bill)
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-gst-enable-rcm"
                        type="checkbox"
                        checked={formData.gst.enableRcm}
                        onChange={(e) => handleUpdate('gst', 'enableRcm', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Enable Reverse Charge Mechanism (RCM) on unregistered purchases
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-gst-print-hsn-summary"
                        type="checkbox"
                        checked={formData.gst.printHsnSummary}
                        onChange={(e) => handleUpdate('gst', 'printHsnSummary', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Print GST / HSN rate summary table at bottom of Tax Invoices
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Group 9: Voucher & Numbering Settings */}
              {activeTab === 'voucher' && (
                <div id="section-settings-voucher" className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-base font-bold text-slate-900">Voucher Numbering & Narration</h2>
                    <p className="text-xs text-slate-500">
                      Configure custom prefixes, starting sequence numbers, and remarks
                    </p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border border-slate-200 rounded">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="p-3">Voucher Type</th>
                          <th className="p-3">Prefix</th>
                          <th className="p-3">Starting Number</th>
                          <th className="p-3">Method</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(
                          [
                            ['salesInvoice', 'Sales Invoice'],
                            ['salesOrder', 'Sales Order'],
                            ['salesReturn', 'Sales Return / Credit Note'],
                            ['purchaseInvoice', 'Purchase Invoice'],
                            ['purchaseOrder', 'Purchase Order'],
                            ['purchaseReturn', 'Purchase Return / Debit Note'],
                            ['customerReceipt', 'Customer Receipt'],
                            ['supplierPayment', 'Supplier Payment'],
                          ] as const
                        ).map(([key, label]) => (
                          <tr key={key} className="hover:bg-slate-50/50">
                            <td className="p-3 font-semibold text-slate-800">{label}</td>
                            <td className="p-2">
                              <input
                                id={`input-voucher-prefix-${key}`}
                                type="text"
                                value={formData.voucher.numbering[key]?.prefix || ''}
                                onChange={(e) => handleVoucherNumbering(key, 'prefix', e.target.value)}
                                className="w-24 px-2 py-1 text-xs border border-slate-300 rounded font-mono uppercase focus:ring-1 focus:ring-blue-500 focus:outline-none"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                id={`input-voucher-start-number-${key}`}
                                type="number"
                                min="1"
                                value={formData.voucher.numbering[key]?.startNumber || 1}
                                onChange={(e) =>
                                  handleVoucherNumbering(key, 'startNumber', parseInt(e.target.value, 10) || 1)
                                }
                                className="w-24 px-2 py-1 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none"
                              />
                            </td>
                            <td className="p-2">
                              <select
                                id={`select-voucher-method-${key}`}
                                value={formData.voucher.numbering[key]?.method || 'AUTOMATIC'}
                                onChange={(e) => handleVoucherNumbering(key, 'method', e.target.value)}
                                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                              >
                                <option value="AUTOMATIC">Automatic</option>
                                <option value="MANUAL">Manual</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="pt-2 space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-voucher-enable-narration"
                        type="checkbox"
                        checked={formData.voucher.enableNarration}
                        onChange={(e) => handleUpdate('voucher', 'enableNarration', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Enable Narration / Notes input field on vouchers
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-voucher-require-narration"
                        type="checkbox"
                        checked={formData.voucher.requireNarration}
                        onChange={(e) => handleUpdate('voucher', 'requireNarration', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Make Narration mandatory before saving or posting vouchers
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Group 10: Print & Invoice Customization Settings */}
              {activeTab === 'print' && (
                <div id="section-settings-print" className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-base font-bold text-slate-900">Print & Invoice Customization</h2>
                    <p className="text-xs text-slate-500">
                      Configure invoice header, terms & conditions, signatory label, and column visibility
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Primary Invoice Title
                      </label>
                      <input
                        id="input-print-invoice-title"
                        type="text"
                        value={formData.print.invoiceTitle}
                        onChange={(e) => handleUpdate('print', 'invoiceTitle', e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded uppercase font-bold focus:ring-1 focus:ring-blue-500 focus:outline-none"
                        placeholder="TAX INVOICE"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Authorized Signatory Label
                      </label>
                      <input
                        id="input-print-signatory-label"
                        type="text"
                        value={formData.print.signatoryLabel}
                        onChange={(e) => handleUpdate('print', 'signatoryLabel', e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                        placeholder="Authorised Signatory"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Default Number of Invoice Copies
                      </label>
                      <select
                        id="select-print-copies"
                        value={formData.print.defaultInvoiceCopies}
                        onChange={(e) => handleUpdate('print', 'defaultInvoiceCopies', parseInt(e.target.value, 10))}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="1">1 Copy (Original for Recipient)</option>
                        <option value="2">2 Copies (Original + Duplicate for Transporter)</option>
                        <option value="3">3 Copies (Original + Duplicate + Triplicate for Supplier)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Terms &amp; Conditions Printed on Invoices
                    </label>
                    <textarea
                      id="textarea-print-terms"
                      rows={3}
                      value={formData.print.termsAndConditionsText}
                      onChange={(e) => handleUpdate('print', 'termsAndConditionsText', e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-print-show-logo"
                        type="checkbox"
                        checked={formData.print.showBusinessLogo}
                        onChange={(e) => handleUpdate('print', 'showBusinessLogo', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">Show Business Logo on print header</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-print-show-terms"
                        type="checkbox"
                        checked={formData.print.showTermsAndConditions}
                        onChange={(e) => handleUpdate('print', 'showTermsAndConditions', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">Print Terms &amp; Conditions footer</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-print-show-signatory"
                        type="checkbox"
                        checked={formData.print.showAuthorizedSignatory}
                        onChange={(e) => handleUpdate('print', 'showAuthorizedSignatory', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">Show Authorized Signatory box</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-print-show-batch-details"
                        type="checkbox"
                        checked={formData.print.showBatchDetails}
                        onChange={(e) => handleUpdate('print', 'showBatchDetails', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Print allocated batch numbers &amp; powers under each item
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-print-show-hsn"
                        type="checkbox"
                        checked={formData.print.showHsnSac}
                        onChange={(e) => handleUpdate('print', 'showHsnSac', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">Show HSN / SAC column in table</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-print-show-discount"
                        type="checkbox"
                        checked={formData.print.showDiscountColumn}
                        onChange={(e) => handleUpdate('print', 'showDiscountColumn', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">Show Discount column in table</span>
                    </label>
                  </div>
                </div>
              )}

              {/* Group 11: Display & Behavior Settings */}
              {activeTab === 'display' && (
                <div id="section-settings-display" className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-base font-bold text-slate-900">Display & UI Behavior</h2>
                    <p className="text-xs text-slate-500">
                      Date formatting, density modes, shortcuts, and batch modal automation
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Date Format</label>
                      <select
                        id="select-display-date-format"
                        value={formData.display.dateFormat}
                        onChange={(e) => handleUpdate('display', 'dateFormat', e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="DD/MM/YYYY">DD/MM/YYYY (Indian Standard)</option>
                        <option value="YYYY-MM-DD">YYYY-MM-DD (ISO Standard)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Table & Grid Density
                      </label>
                      <select
                        id="select-display-density"
                        value={formData.display.density}
                        onChange={(e) => handleUpdate('display', 'density', e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="COMPACT">Compact (Higher Data Density)</option>
                        <option value="COMFORTABLE">Comfortable (Spacious Layout)</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-2 space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-display-stock-badges"
                        type="checkbox"
                        checked={formData.display.showStockBadges}
                        onChange={(e) => handleUpdate('display', 'showStockBadges', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Show visual stock badges (In Stock, Low Stock, Negative) in item selector
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-display-shortcuts"
                        type="checkbox"
                        checked={formData.display.enableShortcuts}
                        onChange={(e) => handleUpdate('display', 'enableShortcuts', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Enable keyboard shortcuts (e.g. F8 for Sales Voucher, F9 for Purchase Voucher)
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-display-auto-open-batch-modal"
                        type="checkbox"
                        checked={formData.display.autoOpenBatchModal}
                        onChange={(e) => handleUpdate('display', 'autoOpenBatchModal', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Automatically open batch selection modal when an optical item is selected on a voucher
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Group 12: Advanced / Control Settings */}
              {activeTab === 'advanced' && (
                <div id="section-settings-advanced" className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-base font-bold text-slate-900">Advanced Control & Compliance</h2>
                    <p className="text-xs text-slate-500">
                      Backdating restrictions, mandatory cancellation remarks, and immutable audit logs
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Backdated Voucher Limit (Days in Past)
                      </label>
                      <input
                        id="input-advanced-backdate-days"
                        type="number"
                        value={formData.advanced.backdateLimitDays}
                        onChange={(e) =>
                          handleUpdate('advanced', 'backdateLimitDays', parseInt(e.target.value, 10) || 0)
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-400">
                        Set to 0 for unlimited backdating or specify maximum days allowed in the past
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-advanced-allow-backdated"
                        type="checkbox"
                        checked={formData.advanced.allowBackdatedVouchers}
                        onChange={(e) => handleUpdate('advanced', 'allowBackdatedVouchers', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Allow creating or updating vouchers with past dates
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-advanced-require-cancel-reason"
                        type="checkbox"
                        checked={formData.advanced.requireCancellationReason}
                        onChange={(e) => handleUpdate('advanced', 'requireCancellationReason', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Require a written cancellation reason when voiding invoices or vouchers
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-advanced-enable-audit-export"
                        type="checkbox"
                        checked={formData.advanced.enableAuditExport}
                        onChange={(e) => handleUpdate('advanced', 'enableAuditExport', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Enable immutable audit trail CSV / JSON export for compliance audits
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="toggle-advanced-restrict-negative-cash"
                        type="checkbox"
                        checked={formData.advanced.restrictNegativeCash}
                        onChange={(e) => handleUpdate('advanced', 'restrictNegativeCash', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        Warn or restrict payment entries that cause cash ledger balance to drop below zero
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Restore Defaults */}
      {showRestoreModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <div className="p-2 bg-amber-50 rounded-full border border-amber-200">
                <RotateCcw className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Restore Recommended Defaults?</h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              This action will reset all configuration options across all 12 groups to standard recommended accounting
              defaults (e.g. Negative Stock Allowed = YES, Credit Limit Action = WARNING, Optical HSN = 9003, GST = 5%).
              Your actual customer ledgers, stock items, and invoices will <strong>NOT</strong> be deleted.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                id="btn-cancel-restore-modal"
                type="button"
                onClick={() => setShowRestoreModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded border border-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-restore-modal"
                type="button"
                onClick={handleRestoreDefaultsConfirm}
                className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded transition-colors shadow-xs"
              >
                Yes, Restore Defaults
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
