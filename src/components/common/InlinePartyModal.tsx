import React, { useState, useEffect, useRef } from 'react';
import { X, UserPlus, Building2, Phone, MapPin, Hash, CreditCard, Loader2, Check } from 'lucide-react';
import { apiRequest } from '../../api/client';

export interface InlinePartyModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPartyType?: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
  initialName?: string;
  onSuccess: (newParty: any) => void;
}

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu & Kashmir',
  'Ladakh', 'Puducherry', 'Chandigarh'
];

const GST_STATE_CODE_MAP: Record<string, string> = {
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
  '38': 'Ladakh',
};

export const InlinePartyModal: React.FC<InlinePartyModalProps> = ({
  isOpen,
  onClose,
  defaultPartyType = 'CUSTOMER',
  initialName = '',
  onSuccess,
}) => {
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: initialName,
    partyCode: '',
    partyType: defaultPartyType,
    phone: '',
    email: '',
    gstin: '',
    state: 'Maharashtra',
    city: '',
    addressLine1: '',
    openingBalance: 0,
    openingBalanceType: 'Dr' as 'Dr' | 'Cr',
    creditLimit: 0,
  });

  const [loadingCode, setLoadingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize or reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        name: initialName || '',
        partyCode: '',
        partyType: defaultPartyType,
        phone: '',
        email: '',
        gstin: '',
        state: 'Maharashtra',
        city: '',
        addressLine1: '',
        openingBalance: 0,
        openingBalanceType: defaultPartyType === 'SUPPLIER' ? 'Cr' : 'Dr',
        creditLimit: 0,
      });
      setErrorMessage(null);

      // Auto-preview next party code from backend
      setLoadingCode(true);
      apiRequest<{ nextCode: string }>(`/api/parties/code-preview?partyType=${defaultPartyType}`)
        .then(res => {
          if (res?.nextCode) {
            setFormData(prev => ({ ...prev, partyCode: res.nextCode }));
          }
        })
        .catch(() => {
          // Fallback code if preview route is unavailable
          const prefix = defaultPartyType === 'SUPPLIER' ? 'SUP' : 'CUST';
          setFormData(prev => ({ ...prev, partyCode: `${prefix}-${Math.floor(1000 + Math.random() * 9000)}` }));
        })
        .finally(() => setLoadingCode(false));

      // Auto-focus the Name field
      setTimeout(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      }, 50);
    }
  }, [isOpen, defaultPartyType, initialName]);

  // Auto-fill state from GSTIN prefix
  const handleGstinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
    let updatedState = formData.state;
    if (val.length >= 2) {
      const code = val.slice(0, 2);
      if (GST_STATE_CODE_MAP[code]) {
        updatedState = GST_STATE_CODE_MAP[code];
      }
    }
    setFormData(prev => ({ ...prev, gstin: val, state: updatedState }));
  };

  // Keyboard shortcut: Esc to cancel, Ctrl+Enter or Cmd+Enter to save
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, formData]);

  if (!isOpen) return null;

  const isSupplier = formData.partyType === 'SUPPLIER';
  const partyTypeTitle = isSupplier ? 'Supplier' : 'Customer';

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.name.trim()) {
      setErrorMessage('Party Name is required.');
      nameInputRef.current?.focus();
      return;
    }

    if (formData.gstin && formData.gstin.length !== 15) {
      setErrorMessage('GSTIN must be exactly 15 characters if provided.');
      return;
    }

    if (formData.phone && !/^\d{10}$/.test(formData.phone.replace(/[^0-9]/g, ''))) {
      setErrorMessage('Phone number must be 10 digits if provided.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        name: formData.name.trim(),
        partyCode: formData.partyCode.trim(),
        partyType: formData.partyType,
        mobile: formData.phone.trim() || undefined,
        email: formData.email.trim() || undefined,
        gstin: formData.gstin.trim() || undefined,
        state: formData.state.trim() || undefined,
        city: formData.city.trim() || undefined,
        addressLine1: formData.addressLine1.trim() || undefined,
        openingBalance: Number(formData.openingBalance) || 0,
        openingBalanceType: formData.openingBalanceType,
        creditLimit: Number(formData.creditLimit) || 0,
        status: 'ACTIVE',
      };

      const newParty = await apiRequest<any>('/api/parties', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      onSuccess(newParty);
      onClose();
    } catch (err: any) {
      console.error('[InlinePartyModal] Failed to create party:', err);
      setErrorMessage(err?.message || err?.error || 'Failed to create party. Please check details.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      id="inline-party-modal-backdrop"
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-3 animate-in fade-in duration-100"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="inline-party-modal"
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-blue-600 rounded-lg text-white">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">Create {partyTypeTitle}</h2>
              <p className="text-[11px] text-slate-400">Creates master record and auto-selects in voucher</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-block text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
              Esc to Cancel • Ctrl+↵ to Save
            </span>
            <button
              type="button"
              id="btn-close-inline-party"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {errorMessage && (
            <div
              id="inline-party-error-banner"
              className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-start gap-2"
            >
              <span className="font-bold shrink-0">Error:</span>
              <span className="flex-1">{errorMessage}</span>
            </div>
          )}

          {/* Party Type & Code */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Party Type <span className="text-rose-500">*</span>
              </label>
              <select
                id="inline-party-type"
                value={formData.partyType}
                onChange={e => setFormData({ ...formData, partyType: e.target.value as any })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:outline-none"
              >
                <option value="CUSTOMER">Customer (Debtor)</option>
                <option value="SUPPLIER">Supplier (Creditor)</option>
                <option value="BOTH">Both (Customer & Supplier)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Party Code {loadingCode && <span className="text-[10px] text-blue-600 font-normal">(loading...)</span>}
              </label>
              <div className="relative">
                <input
                  id="inline-party-code"
                  type="text"
                  value={formData.partyCode}
                  onChange={e => setFormData({ ...formData, partyCode: e.target.value.toUpperCase() })}
                  placeholder="Auto-generated if empty"
                  className="w-full px-3 py-2 font-mono uppercase border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-slate-700 font-bold mb-1">
              Party / Company Name <span className="text-rose-500">*</span>
            </label>
            <input
              ref={nameInputRef}
              id="inline-party-name"
              type="text"
              required
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Goyal New Optical or Sharma Eyes"
              className="w-full px-3 py-2 text-sm font-semibold border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {/* Contact Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Mobile / Phone
              </label>
              <div className="relative">
                <input
                  id="inline-party-phone"
                  type="tel"
                  maxLength={10}
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value.replace(/[^0-9]/g, '') })}
                  placeholder="10-digit mobile number"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                GSTIN (15 Digits)
              </label>
              <input
                id="inline-party-gstin"
                type="text"
                maxLength={15}
                value={formData.gstin}
                onChange={handleGstinChange}
                placeholder="e.g. 27AAAAA0000A1Z5"
                className="w-full px-3 py-2 font-mono uppercase border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {/* State & City */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                State / Place of Supply
              </label>
              <select
                id="inline-party-state"
                value={formData.state}
                onChange={e => setFormData({ ...formData, state: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:outline-none"
              >
                {INDIAN_STATES.map(st => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                City / Town
              </label>
              <input
                id="inline-party-city"
                type="text"
                value={formData.city}
                onChange={e => setFormData({ ...formData, city: e.target.value })}
                placeholder="e.g. Mumbai or Pune"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-slate-600 font-semibold mb-1">
              Billing Address
            </label>
            <input
              id="inline-party-address"
              type="text"
              value={formData.addressLine1}
              onChange={e => setFormData({ ...formData, addressLine1: e.target.value })}
              placeholder="Shop No, Street, Landmark"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {/* Financials: Opening Balance & Credit Limit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Opening Balance (₹)
              </label>
              <div className="flex gap-1.5">
                <input
                  id="inline-party-opening-balance"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.openingBalance || ''}
                  onChange={e => setFormData({ ...formData, openingBalance: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="flex-1 px-3 py-2 font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:outline-none"
                />
                <select
                  id="inline-party-balance-type"
                  value={formData.openingBalanceType}
                  onChange={e => setFormData({ ...formData, openingBalanceType: e.target.value as any })}
                  className="w-18 px-2 py-2 border border-slate-300 rounded-lg bg-slate-50 font-bold text-center focus:outline-none"
                >
                  <option value="Dr">Dr (Receivable)</option>
                  <option value="Cr">Cr (Payable)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Credit Limit (₹)
              </label>
              <input
                id="inline-party-credit-limit"
                type="number"
                min="0"
                step="100"
                value={formData.creditLimit || ''}
                onChange={e => setFormData({ ...formData, creditLimit: parseFloat(e.target.value) || 0 })}
                placeholder="0 for unlimited"
                className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Actions Footer */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              id="btn-cancel-inline-party"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg font-semibold transition-colors disabled:opacity-50"
            >
              Cancel (Esc)
            </button>
            <button
              type="submit"
              id="btn-save-inline-party"
              disabled={submitting}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-2 shadow-sm transition-all active:scale-98 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving & Selecting...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Save & Select (↵)</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
