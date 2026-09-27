import React, { useState, useEffect } from 'react';
import {
  Building2,
  Store,
  CheckCircle2,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Lock,
  Eye,
  RefreshCw,
  AlertCircle,
  ShoppingCart,
  Search,
  Boxes,
  Truck,
  CreditCard,
  Sparkles,
  Info,
  Check,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';

interface DealerOnboardingPageProps {
  onNavigate: (path: string) => void;
  onComplete?: () => void;
}

export const DealerOnboardingPage: React.FC<DealerOnboardingPageProps> = ({
  onNavigate,
  onComplete,
}) => {
  const { currentBusiness, user, refreshUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Wizard Step: 1 = Welcome, 2 = Business Details, 3 = Main Warehouse Connection, 4 = Preferences, 5 = Ready
  const [step, setStep] = useState<number>(1);

  // Onboarding Data from Backend
  const [statusData, setStatusData] = useState<{
    isDealer: boolean;
    onboardingCompleted: boolean;
    canConfigure: boolean;
    dealer: {
      id: string;
      code: string;
      name: string;
      tradeName: string | null;
      gstin: string | null;
      pan: string | null;
      phone: string | null;
      email: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      state: string | null;
      stateCode: string | null;
      pincode: string | null;
    };
    mainWarehouse: {
      id: string;
      name: string;
      tradeName: string | null;
      dealerCode: string;
      creditLimit: number;
      creditDays: number;
      connected: boolean;
    };
    preferences: {
      shareStockWithMain: boolean;
      defaultUnit: string;
      defaultGstRate: number;
    };
  } | null>(null);

  // Step 2: Form State
  const [businessForm, setBusinessForm] = useState({
    name: '',
    tradeName: '',
    gstin: '',
    pan: '',
    phone: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: 'Karnataka',
    stateCode: '29',
    pincode: '',
  });

  // Step 4: Preference State
  const [shareStockWithMain, setShareStockWithMain] = useState(false);

  // Fetch status on load
  useEffect(() => {
    fetchStatus();
  }, [currentBusiness?.id]);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest('/api/dealer/onboarding/status');
      setStatusData(res);

      if (res.dealer) {
        setBusinessForm({
          name: res.dealer.name || '',
          tradeName: res.dealer.tradeName || '',
          gstin: res.dealer.gstin || '',
          pan: res.dealer.pan || '',
          phone: res.dealer.phone || '',
          email: res.dealer.email || '',
          addressLine1: res.dealer.addressLine1 || '',
          addressLine2: res.dealer.addressLine2 || '',
          city: res.dealer.city || '',
          state: res.dealer.state || 'Karnataka',
          stateCode: res.dealer.stateCode || '29',
          pincode: res.dealer.pincode || '',
        });
      }

      if (res.preferences) {
        setShareStockWithMain(Boolean(res.preferences.shareStockWithMain));
      }

      // If non-dealer, redirect immediately to dashboard
      if (!res.isDealer) {
        onNavigate('/dashboard');
        return;
      }
    } catch (err: any) {
      console.error('[ONBOARDING_FETCH_ERROR]', err);
      setError(err.message || 'Failed to load onboarding status.');
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    try {
      await apiRequest('/api/dealer/onboarding/start', { method: 'POST' });
    } catch {
      // Non-blocking log error
    }
    setStep(2);
  };

  const handleSaveBusinessDetails = async () => {
    if (!businessForm.name.trim()) {
      setError('Business Name is required.');
      return;
    }
    if (!businessForm.state.trim() || !businessForm.stateCode.trim()) {
      setError('State and State Code are mandatory for GST invoice generation.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiRequest('/api/dealer/onboarding/business-details', {
        method: 'PUT',
        body: JSON.stringify(businessForm),
      });
      setSuccessMsg('Business details saved.');
      setTimeout(() => setSuccessMsg(null), 3000);
      setStep(3);
    } catch (err: any) {
      setError(err.message || 'Failed to update business details.');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePreferences = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiRequest('/api/dealer/onboarding/preferences', {
        method: 'POST',
        body: JSON.stringify({ shareStockWithMain }),
      });
      setStep(5);
    } catch (err: any) {
      setError(err.message || 'Failed to save preferences.');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteOnboarding = async () => {
    if (completing) return;
    setCompleting(true);
    setError(null);
    try {
      await apiRequest('/api/dealer/onboarding/complete', { method: 'POST' });
      sessionStorage.setItem('dealer_just_onboarded', 'true');
      await refreshUser();
      if (onComplete) {
        onComplete();
      } else {
        onNavigate('/dealer/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to complete onboarding.');
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-8 text-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mb-3" />
        <p className="text-sm font-medium text-slate-600">Loading Dealer Setup...</p>
      </div>
    );
  }

  // Edge case: Viewer / Non-Manager logging in before setup
  if (statusData && !statusData.canConfigure) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white rounded-2xl border border-slate-200 shadow-sm text-center space-y-6">
        <div className="w-16 h-16 bg-amber-50 text-amber-600 border border-amber-200 rounded-2xl flex items-center justify-center mx-auto">
          <Lock className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <span className="px-2.5 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-purple-100 text-purple-800">
            {statusData.dealer.code || 'DEALER'}
          </span>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Account Setup in Progress
          </h1>
          <p className="text-sm text-slate-600 max-w-lg mx-auto">
            Your dealer account setup for <strong className="text-slate-800">{statusData.dealer.name}</strong> is awaiting completion by an administrator.
          </p>
        </div>

        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-left text-xs text-slate-600 space-y-2 max-w-md mx-auto">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-500">Logged-in User:</span>
            <span className="font-semibold text-slate-800">{user?.fullName || user?.username}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-500">Connected Warehouse:</span>
            <span className="font-semibold text-slate-800">{statusData.mainWarehouse?.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-500">Setup Status:</span>
            <span className="font-bold text-amber-600">Pending Manager Confirmation</span>
          </div>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => onNavigate('/dealer/dashboard')}
            className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-colors"
          >
            <Eye className="w-4 h-4" />
            Go to Read-Only Dashboard
          </button>
        </div>
      </div>
    );
  }

  const dealer = statusData?.dealer || {
    name: currentBusiness?.name || 'Dealer Store',
    code: 'DLR-0001',
    tradeName: '',
  };
  const mainWarehouse = statusData?.mainWarehouse || {
    name: 'Main Optical Warehouse',
    dealerCode: 'DLR-0001',
    creditLimit: 0,
    creditDays: 0,
    connected: true,
  };

  const stepsList = [
    { num: 1, label: 'Welcome' },
    { num: 2, label: 'Business' },
    { num: 3, label: 'Warehouse' },
    { num: 4, label: 'Preferences' },
    { num: 5, label: 'Ready' },
  ];

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Progress Header */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-purple-100 text-purple-800">
                DEALER SETUP
              </span>
              <span className="text-xs font-mono font-bold text-slate-500">
                {dealer.code}
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-1">
              Welcome to VisionPro Optical ERP
            </h1>
          </div>
          <button
            onClick={() => onNavigate('/dealer/dashboard')}
            className="text-xs text-slate-500 hover:text-slate-800 underline self-start sm:self-center"
          >
            Skip for now & view dashboard
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between mt-4 overflow-x-auto py-1">
          {stepsList.map((s, idx) => {
            const isCompleted = step > s.num;
            const isCurrent = step === s.num;
            return (
              <React.Fragment key={s.num}>
                <div className="flex items-center gap-2 shrink-0">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      isCompleted
                        ? 'bg-emerald-600 text-white'
                        : isCurrent
                        ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {isCompleted ? <Check className="w-3.5 h-3.5" /> : s.num}
                  </div>
                  <span
                    className={`text-xs font-semibold ${
                      isCurrent ? 'text-blue-600' : isCompleted ? 'text-slate-800' : 'text-slate-400'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < stepsList.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 min-w-[20px] transition-colors ${
                      step > s.num ? 'bg-emerald-500' : 'bg-slate-200'
                    }`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* STEP 1: WELCOME */}
      {step === 1 && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Welcome, {dealer.name}!
              </h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Your dealer portal is linked directly with your primary supplier. You can check live stock availability, place stock orders, track incoming shipments, and manage your local optical billing.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Dealer Name
              </span>
              <p className="text-sm font-bold text-slate-900 mt-1 truncate">{dealer.name}</p>
              <p className="text-xs text-slate-500 truncate">{dealer.tradeName || 'Independent Retailer'}</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Dealer Code
              </span>
              <p className="text-sm font-mono font-bold text-blue-600 mt-1">{dealer.code}</p>
              <p className="text-[11px] text-slate-400">Assigned by Main Warehouse</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Connected Warehouse
              </span>
              <p className="text-sm font-bold text-slate-900 mt-1 truncate">{mainWarehouse.name}</p>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 mt-0.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Connected
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-100 text-xs text-blue-900 space-y-1 leading-relaxed">
            <p className="font-semibold text-blue-950 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-blue-600 shrink-0" />
              What you can do from this portal:
            </p>
            <ul className="list-disc list-inside space-y-1 text-blue-800 pl-1">
              <li>Check real-time optical lens, frame, and batch power availability at {mainWarehouse.name}</li>
              <li>Submit purchase orders directly against your authorized credit terms</li>
              <li>Track dispatches and confirm delivery receipts directly into your local inventory</li>
              <li>Manage your retail sales, customer billing, and local store operations</li>
            </ul>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <button
              onClick={() => onNavigate('/dealer/dashboard')}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
            >
              Skip for now
            </button>
            <button
              id="onboarding-get-started-btn"
              onClick={handleStart}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm transition-colors"
            >
              Get Started
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: BUSINESS DETAILS */}
      {step === 2 && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Verify Business Master Details
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              These details were initialized by the Main Warehouse administrator. Please review and update contact or tax identifiers for local GST compliance.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Business Legal Name *
              </label>
              <input
                type="text"
                value={businessForm.name}
                onChange={(e) => setBusinessForm({ ...businessForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="ABC Opticals Pvt Ltd"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Trade / Display Name
              </label>
              <input
                type="text"
                value={businessForm.tradeName}
                onChange={(e) => setBusinessForm({ ...businessForm, tradeName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="ABC Opticals"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                GSTIN (15 characters)
              </label>
              <input
                type="text"
                value={businessForm.gstin}
                onChange={(e) => setBusinessForm({ ...businessForm, gstin: e.target.value.toUpperCase() })}
                maxLength={15}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-blue-500"
                placeholder="29AAAAA0000A1Z5"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Permanent Account Number (PAN)
              </label>
              <input
                type="text"
                value={businessForm.pan}
                onChange={(e) => setBusinessForm({ ...businessForm, pan: e.target.value.toUpperCase() })}
                maxLength={10}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-blue-500"
                placeholder="AAAAA0000A"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Phone / Mobile Number
              </label>
              <input
                type="text"
                value={businessForm.phone}
                onChange={(e) => setBusinessForm({ ...businessForm, phone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="+91 98765 43210"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Contact Email
              </label>
              <input
                type="email"
                value={businessForm.email}
                onChange={(e) => setBusinessForm({ ...businessForm, email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="orders@dealer.com"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Address Line 1
              </label>
              <input
                type="text"
                value={businessForm.addressLine1}
                onChange={(e) => setBusinessForm({ ...businessForm, addressLine1: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Shop #4, Commercial Street"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                City
              </label>
              <input
                type="text"
                value={businessForm.city}
                onChange={(e) => setBusinessForm({ ...businessForm, city: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Bengaluru"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  State *
                </label>
                <input
                  type="text"
                  value={businessForm.state}
                  onChange={(e) => setBusinessForm({ ...businessForm, state: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Karnataka"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  State Code *
                </label>
                <input
                  type="text"
                  value={businessForm.stateCode}
                  onChange={(e) => setBusinessForm({ ...businessForm, stateCode: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="29"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                PIN Code
              </label>
              <input
                type="text"
                value={businessForm.pincode}
                onChange={(e) => setBusinessForm({ ...businessForm, pincode: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="560001"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <button
              id="onboarding-step2-next-btn"
              onClick={handleSaveBusinessDetails}
              disabled={saving}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm transition-colors disabled:opacity-50"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
              Save & Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: MAIN WAREHOUSE CONNECTION */}
      {step === 3 && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Main Warehouse Relationship
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Your dealer entity is commercially linked to the following primary optical hub.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-50 to-blue-50/40 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-base shadow-xs">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Primary Optical Hub
                  </span>
                  <p className="text-sm font-bold text-slate-900">{mainWarehouse.name}</p>
                </div>
              </div>
              <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Live Link Active
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-500 font-medium">Your Dealer Code</span>
                <p className="font-mono font-bold text-blue-600 text-sm mt-0.5">{dealer.code}</p>
              </div>

              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-500 font-medium">Assigned Credit Limit</span>
                <p className="font-bold text-slate-900 text-sm mt-0.5">
                  ₹{Number(mainWarehouse.creditLimit || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </p>
              </div>

              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-500 font-medium">Credit Period</span>
                <p className="font-bold text-slate-900 text-sm mt-0.5">
                  {mainWarehouse.creditDays > 0 ? `${mainWarehouse.creditDays} Days` : 'Immediate / Pre-paid'}
                </p>
              </div>

              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-500 font-medium">Stock Catalog</span>
                <p className="font-bold text-emerald-700 text-sm mt-0.5 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Full Catalog
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-500 italic">
              Note: Dealer affiliation and credit limit terms are managed by the Main Warehouse administration team.
            </p>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <button
              id="onboarding-step3-next-btn"
              onClick={() => setStep(4)}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm transition-colors"
            >
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: INVENTORY PREFERENCES */}
      {step === 4 && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Inventory & Privacy Preferences
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Configure how your store collaborates with the connected Main Warehouse.
            </p>
          </div>

          <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 max-w-xl">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    Share Stock Availability with Main Warehouse
                  </h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">
                    Default: OFF
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  When enabled, Main Warehouse inventory managers can see your currently available physical quantities to recommend restocks and coordinate supply.
                </p>
              </div>

              {/* Toggle Switch */}
              <button
                type="button"
                id="toggle-share-stock"
                onClick={() => setShareStockWithMain(!shareStockWithMain)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                  shareStockWithMain ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    shareStockWithMain ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="p-3 bg-white rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Strict Privacy Guarantee:
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Even with stock sharing enabled, Main Warehouse <strong>never</strong> has access to your retail selling prices, purchase costs, profit margins, customer directory, or non-main supplier receipts.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <button
              onClick={() => setStep(3)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <button
              id="onboarding-step4-next-btn"
              onClick={handleSavePreferences}
              disabled={saving}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm transition-colors disabled:opacity-50"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
              Save & Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: READY */}
      {step === 5 && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
              <Sparkles className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              Your Dealer Account is Ready!
            </h2>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Setup is complete. You can now start exploring Main Warehouse stock, submitting requisitions, or managing your local optical store.
            </p>
          </div>

          {/* Simple 5-step operational workflow card */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider text-center">
              Recommended Daily Workflow
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-center text-xs">
              <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold inline-flex items-center justify-center mb-1">
                  1
                </span>
                <p className="font-semibold text-slate-800">Check Stock</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Browse available items & powers</p>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold inline-flex items-center justify-center mb-1">
                  2
                </span>
                <p className="font-semibold text-slate-800">Select Powers</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Specify SPH/CYL batch quantities</p>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold inline-flex items-center justify-center mb-1">
                  3
                </span>
                <p className="font-semibold text-slate-800">Place Order</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Requisition against credit limit</p>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold inline-flex items-center justify-center mb-1">
                  4
                </span>
                <p className="font-semibold text-slate-800">Track Transit</p>
                <p className="text-[10px] text-slate-400 mt-0.5">View vehicle & consignment #</p>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold inline-flex items-center justify-center mb-1">
                  5
                </span>
                <p className="font-semibold text-slate-800">Receive Goods</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Auto-increments local inventory</p>
              </div>
            </div>
          </div>

          {/* 4 Action Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
            <button
              onClick={() => {
                handleCompleteOnboarding().then(() => onNavigate('/inventory/dealer-availability'));
              }}
              className="p-4 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50/40 transition-all flex items-start gap-3 group"
            >
              <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                <Search className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900 group-hover:text-blue-600">
                  Check Main Stock
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Browse live available optical items and powers from {mainWarehouse.name}.
                </p>
              </div>
            </button>

            <button
              onClick={() => {
                handleCompleteOnboarding().then(() => onNavigate('/inventory/dealer-availability'));
              }}
              className="p-4 rounded-xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40 transition-all flex items-start gap-3 group"
            >
              <div className="p-2.5 bg-emerald-100 text-emerald-600 rounded-xl shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900 group-hover:text-emerald-600">
                  Place First Stock Order
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Order stock replenishments directly against your available credit.
                </p>
              </div>
            </button>

            <button
              onClick={() => {
                handleCompleteOnboarding().then(() => onNavigate('/master/stock-items'));
              }}
              className="p-4 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/40 transition-all flex items-start gap-3 group"
            >
              <div className="p-2.5 bg-indigo-100 text-indigo-600 rounded-xl shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <Boxes className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600">
                  View My Stock
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Review local store inventory and optical batch balances.
                </p>
              </div>
            </button>

            <button
              onClick={() => {
                handleCompleteOnboarding().then(() => onNavigate('/dealer/dashboard'));
              }}
              className="p-4 rounded-xl border border-slate-200 hover:border-purple-500 hover:bg-purple-50/40 transition-all flex items-start gap-3 group"
            >
              <div className="p-2.5 bg-purple-100 text-purple-600 rounded-xl shrink-0 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900 group-hover:text-purple-600">
                  Go to Dealer Dashboard
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Access operations overview, pending receipts, and quick actions.
                </p>
              </div>
            </button>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <button
              onClick={() => setStep(4)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <button
              id="onboarding-finish-setup-btn"
              onClick={handleCompleteOnboarding}
              disabled={completing}
              className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-md transition-colors disabled:opacity-50"
            >
              {completing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              FINISH SETUP
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
