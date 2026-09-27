import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Building2,
  AlertTriangle,
  CheckCircle2,
  Search,
  Lock,
  UserCheck,
  CreditCard,
  MapPin,
  FileText,
  HelpCircle,
  Loader2,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';

interface CreateDealerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newDealer: any) => void;
}

export const CreateDealerModal: React.FC<CreateDealerModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [pincode, setPincode] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [creditDays, setCreditDays] = useState('30');

  // Customer link mode
  const [customerLinkMode, setCustomerLinkMode] = useState<'CREATE_NEW' | 'LINK_EXISTING'>('CREATE_NEW');
  const [existingCustomerPartyId, setExistingCustomerPartyId] = useState('');
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);

  // Duplicate checks & warnings
  const [duplicateWarning, setDuplicateWarning] = useState<any | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [ignoreDuplicateCheck, setIgnoreDuplicateCheck] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Indian States & GST state code map
  const STATE_CODES: Record<string, string> = {
    '01': 'Jammu & Kashmir',
    '02': 'Himachal Pradesh',
    '03': 'Punjab',
    '04': 'Chandigarh',
    '05': 'Uttarakhand',
    '06': 'Haryana',
    '07': 'Delhi',
    '08': 'Rajasthan',
    '09': 'Uttar Pradesh',
    '10': 'Bihar',
    '11': 'Sikkim',
    '12': 'Arunachal Pradesh',
    '13': 'Nagaland',
    '14': 'Manipur',
    '15': 'Mizoram',
    '16': 'Tripura',
    '17': 'Meghalaya',
    '18': 'Assam',
    '19': 'West Bengal',
    '20': 'Jharkhand',
    '21': 'Odisha',
    '22': 'Chhattisgarh',
    '23': 'Madhya Pradesh',
    '24': 'Gujarat',
    '27': 'Maharashtra',
    '29': 'Karnataka',
    '30': 'Goa',
    '32': 'Kerala',
    '33': 'Tamil Nadu',
    '36': 'Telangana',
    '37': 'Andhra Pradesh',
  };

  // Auto-extract State and PAN from GSTIN
  const handleGstinChange = (val: string) => {
    const cleanGstin = val.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setGstin(cleanGstin);

    if (cleanGstin.length >= 2) {
      const code = cleanGstin.slice(0, 2);
      setStateCode(code);
      if (STATE_CODES[code]) {
        setState(STATE_CODES[code]);
      }
    }
    if (cleanGstin.length >= 12 && !pan) {
      const extractedPan = cleanGstin.slice(2, 12);
      setPan(extractedPan);
    }
  };

  // Search existing customers when in LINK_EXISTING mode
  const searchCustomers = useCallback(async (query: string) => {
    try {
      setSearchingCustomers(true);
      const res = await apiRequest<{ success: boolean; customers: any[] }>(
        `/api/main/dealers/search-customers?query=${encodeURIComponent(query)}&limit=15`
      );
      if (res.success) {
        setSearchResults(res.customers || []);
      }
    } catch (err: any) {
      console.error('Customer search error', err);
    } finally {
      setSearchingCustomers(false);
    }
  }, []);

  useEffect(() => {
    if (customerLinkMode === 'LINK_EXISTING') {
      const timer = setTimeout(() => {
        searchCustomers(customerSearchQuery);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [customerLinkMode, customerSearchQuery, searchCustomers]);

  // Check for duplicate customer on blur of GSTIN or Name
  const checkDuplicateCustomer = async () => {
    if (customerLinkMode === 'LINK_EXISTING' || ignoreDuplicateCheck) return;
    if (!gstin && name.trim().length < 3) return;

    try {
      setCheckingDuplicates(true);
      const params = new URLSearchParams();
      if (gstin) params.append('gstin', gstin);
      if (name) params.append('name', name);

      const res = await apiRequest<{ success: boolean; hasProbableDuplicate: boolean; probableMatches: any[] }>(
        `/api/main/dealers/check-customer-duplicate?${params.toString()}`
      );
      if (res.success && res.hasProbableDuplicate) {
        setDuplicateWarning(res.probableMatches);
      } else {
        setDuplicateWarning(null);
      }
    } catch (err) {
      // Non-blocking duplicate check
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent, overrideDup = false) => {
    if (e) e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Dealer Business Name is mandatory.');
      return;
    }

    if (customerLinkMode === 'LINK_EXISTING' && !existingCustomerPartyId) {
      setError('Please select an existing Customer Party to link.');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        name: name.trim(),
        tradeName: tradeName.trim() || undefined,
        gstin: gstin.trim() || undefined,
        pan: pan.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        stateCode: stateCode.trim() || undefined,
        pincode: pincode.trim() || undefined,
        creditLimit: creditLimit ? parseFloat(creditLimit) : 0,
        creditDays: creditDays ? parseInt(creditDays, 10) : 0,
        customerLinkMode,
        existingCustomerPartyId: customerLinkMode === 'LINK_EXISTING' ? existingCustomerPartyId : undefined,
        ignoreDuplicateCheck: overrideDup || ignoreDuplicateCheck,
      };

      const res = await apiRequest<{
        success: boolean;
        requiresConfirmation?: boolean;
        probableMatches?: any[];
        dealer?: any;
        message?: string;
        error?: string;
      }>('/api/main/dealers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.requiresConfirmation && res.probableMatches) {
        setDuplicateWarning(res.probableMatches);
        setSubmitting(false);
        return;
      }

      if (res.success && res.dealer) {
        onSuccess(res.dealer);
        onClose();
      } else {
        setError(res.error || 'Failed to create dealer.');
      }
    } catch (err: any) {
      setError(err.message || 'Error occurred while creating dealer company.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl my-8 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center text-blue-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Onboard New Dealer Company</h2>
              <p className="text-xs text-slate-300">
                Phase 4A: Commercial entity creation & automated bi-directional party mapping
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={(e) => handleSubmit(e, false)} className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700 text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
              <div className="flex-1">
                <span className="font-semibold block">Submission Error</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Probable Duplicate Alert */}
          {duplicateWarning && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-amber-800">
                    Probable Matching Customer Found in Main Warehouse
                  </h4>
                  <p className="text-xs text-amber-700 mt-0.5">
                    We found existing customer party record(s) matching the GSTIN or Name. You can link the existing
                    customer to keep ledger continuity, or confirm creation of an independent dealer record.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 max-h-36 overflow-y-auto bg-white/80 p-2.5 rounded-lg border border-amber-200">
                {duplicateWarning.map((m: any) => (
                  <div
                    key={m.id}
                    className="text-xs flex items-center justify-between p-2 rounded hover:bg-amber-100/50 transition-colors border-b border-amber-100 last:border-0"
                  >
                    <div>
                      <span className="font-bold text-slate-800">{m.name}</span>
                      {m.party_code && (
                        <span className="ml-2 font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                          {m.party_code}
                        </span>
                      )}
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {m.gstin ? `GSTIN: ${m.gstin}` : 'No GSTIN'} • {m.city || 'No City'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerLinkMode('LINK_EXISTING');
                        setExistingCustomerPartyId(m.id);
                        setSelectedCustomer(m);
                        setDuplicateWarning(null);
                        setIgnoreDuplicateCheck(true);
                      }}
                      className="px-2.5 py-1 bg-blue-600 text-white font-medium rounded text-[11px] hover:bg-blue-700"
                    >
                      Link This Party
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setDuplicateWarning(null);
                    setIgnoreDuplicateCheck(true);
                  }}
                  className="px-3 py-1.5 text-xs text-amber-800 font-medium hover:bg-amber-100 rounded-lg"
                >
                  Dismiss Warning
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmit(undefined, true)}
                  disabled={submitting}
                  className="px-3 py-1.5 text-xs font-bold bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                >
                  Create Dealer Regardless
                </button>
              </div>
            </div>
          )}

          {/* Section 1: Business Identity */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <Building2 className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">1. Dealer Business Master</h3>
              <span className="text-[11px] text-slate-400 font-mono ml-auto">Code assigned on save (DLR-XXXX)</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Business Legal Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Vision Care Optics"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={checkDuplicateCustomer}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Trade / Display Name</label>
                <input
                  type="text"
                  placeholder="e.g., Vision Care"
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">GSTIN (15 Digits)</label>
                <input
                  type="text"
                  maxLength={15}
                  placeholder="27AABCC1234F1Z1"
                  value={gstin}
                  onChange={(e) => handleGstinChange(e.target.value)}
                  onBlur={checkDuplicateCustomer}
                  className="w-full text-sm font-mono uppercase px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">PAN Number (10 Digits)</label>
                <input
                  type="text"
                  maxLength={10}
                  placeholder="AABCC1234F"
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase())}
                  className="w-full text-sm font-mono uppercase px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Contact Phone / Mobile</label>
                <input
                  type="tel"
                  placeholder="e.g., 9820123456"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Official Email</label>
                <input
                  type="email"
                  placeholder="dealer@visioncare.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Address & Location */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <MapPin className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">2. Registered Address</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-1">
                <label className="text-xs font-semibold text-slate-700">Address Line 1</label>
                <input
                  type="text"
                  placeholder="Shop No. 4, Ground Floor, Market Road"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Address Line 2</label>
                <input
                  type="text"
                  placeholder="Near Railway Station"
                  value={addressLine2}
                  onChange={(e) => setAddressLine2(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">City</label>
                <input
                  type="text"
                  placeholder="e.g., Pune"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">State</label>
                <input
                  type="text"
                  placeholder="e.g., Maharashtra"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Pincode</label>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="411001"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Commercial Party Linkage */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <CreditCard className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                3. Commercial Party Mapping (Main Warehouse Customer)
              </h3>
            </div>

            {/* Mode Selector */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setCustomerLinkMode('CREATE_NEW');
                  setExistingCustomerPartyId('');
                  setSelectedCustomer(null);
                }}
                className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                  customerLinkMode === 'CREATE_NEW'
                    ? 'border-blue-600 bg-blue-50/50 text-blue-900 ring-2 ring-blue-500/20'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center mt-0.5 ${
                    customerLinkMode === 'CREATE_NEW'
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300'
                  }`}
                >
                  {customerLinkMode === 'CREATE_NEW' && <CheckCircle2 className="w-3.5 h-3.5" />}
                </div>
                <div>
                  <span className="text-xs font-bold block">Create New Customer Party</span>
                  <span className="text-[11px] text-slate-500 block mt-0.5">
                    Automatically provisions a fresh customer account in Main Warehouse with party code and tags.
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCustomerLinkMode('LINK_EXISTING');
                  if (searchResults.length === 0) searchCustomers('');
                }}
                className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                  customerLinkMode === 'LINK_EXISTING'
                    ? 'border-blue-600 bg-blue-50/50 text-blue-900 ring-2 ring-blue-500/20'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center mt-0.5 ${
                    customerLinkMode === 'LINK_EXISTING'
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300'
                  }`}
                >
                  {customerLinkMode === 'LINK_EXISTING' && <CheckCircle2 className="w-3.5 h-3.5" />}
                </div>
                <div>
                  <span className="text-xs font-bold block">Link Existing Customer Party</span>
                  <span className="text-[11px] text-slate-500 block mt-0.5">
                    Connect an existing customer account so sales history, orders, and ledger continuity are maintained.
                  </span>
                </div>
              </button>
            </div>

            {/* Existing Customer Picker */}
            {customerLinkMode === 'LINK_EXISTING' && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                  <span>Select Main Warehouse Customer Party</span>
                  {selectedCustomer && (
                    <span className="text-blue-600 font-normal">Selected: {selectedCustomer.name}</span>
                  )}
                </label>

                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by customer name, party code, GSTIN, city..."
                    value={customerSearchQuery}
                    onChange={(e) => setCustomerSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
                  />
                  {searchingCustomers && (
                    <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-3 text-slate-400" />
                  )}
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1 bg-white border border-slate-200 rounded-lg p-1.5 divide-y divide-slate-100">
                  {searchResults.length === 0 ? (
                    <div className="text-xs text-center py-4 text-slate-400">
                      {searchingCustomers ? 'Searching...' : 'No customers matching search criteria.'}
                    </div>
                  ) : (
                    searchResults.map((cust) => (
                      <div
                        key={cust.id}
                        onClick={() => {
                          setExistingCustomerPartyId(cust.id);
                          setSelectedCustomer(cust);
                          if (cust.creditLimit && !creditLimit) setCreditLimit(cust.creditLimit);
                          if (cust.creditDays && creditDays === '30') setCreditDays(cust.creditDays);
                        }}
                        className={`p-2 rounded-md cursor-pointer text-xs flex items-center justify-between transition-colors ${
                          existingCustomerPartyId === cust.id
                            ? 'bg-blue-50 border border-blue-200 font-semibold text-blue-900'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold">{cust.name}</span>
                            <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1 py-0.2 rounded">
                              {cust.partyCode}
                            </span>
                            {cust.isAlreadyLinked && (
                              <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-medium">
                                Already linked
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {cust.gstin ? `GSTIN: ${cust.gstin}` : 'No GSTIN'} • {cust.city || 'No City'}
                          </div>
                        </div>
                        <div className="text-right text-[11px]">
                          <span className="text-slate-500 block">
                            Credit: ₹{Number(cust.creditLimit || 0).toLocaleString('en-IN')}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Credit Terms */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Credit Limit (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  placeholder="e.g., 200000"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-[11px] text-slate-400">Set 0 for cash-only or advance basis</span>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Credit Days</label>
                <input
                  type="number"
                  min="0"
                  placeholder="30"
                  value={creditDays}
                  onChange={(e) => setCreditDays(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-[11px] text-slate-400">Payment term days from invoice date</span>
              </div>
            </div>
          </div>

          {/* Reassurance Callout Box */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              Automated Safety Protocols Initialized:
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-slate-500">
              <li>Dealer Stock Sharing is set to <strong>Private (OFF)</strong> by default to protect dealer confidentiality.</li>
              <li>Main Supplier Party is automatically provisioned inside Dealer business with clean commercial info.</li>
              <li>User login creation will follow in <strong>Phase 4B</strong> without affecting accounting setup.</li>
            </ul>
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || checkingDuplicates}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 shadow-sm flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Onboarding Dealer...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Create Dealer Company</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
