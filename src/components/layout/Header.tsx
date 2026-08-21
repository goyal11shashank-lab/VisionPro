import React, { useState } from 'react';
import {
  Menu,
  Building2,
  ChevronDown,
  Database,
  Shield,
  History,
  Check,
  CheckCircle2,
  AlertCircle,
  Search,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { DatabaseStatusModal } from '../common/DatabaseStatusModal.js';
import { GlobalSearchModal } from '../search/GlobalSearchModal.js';

interface HeaderProps {
  onToggleMobileSidebar: () => void;
  title: string;
  onNavigate: (path: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleMobileSidebar,
  title,
  onNavigate,
}) => {
  const { user, currentBusiness, accessibleBusinesses, switchBusiness } = useAuth();
  const [isBizDropdownOpen, setIsBizDropdownOpen] = useState<boolean>(false);
  const [isDbModalOpen, setIsDbModalOpen] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isSwitching, setIsSwitching] = useState<boolean>(false);

  const handleSelectBusiness = async (bizId: string) => {
    if (bizId === currentBusiness?.id) {
      setIsBizDropdownOpen(false);
      return;
    }
    setIsSwitching(true);
    try {
      await switchBusiness(bizId);
    } finally {
      setIsSwitching(false);
      setIsBizDropdownOpen(false);
    }
  };

  return (
    <>
      <header
        id="app-header"
        className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 md:px-8 bg-white border-b border-slate-200 shrink-0"
      >
        {/* Left Section: Mobile Toggle & Page Title */}
        <div className="flex items-center gap-3">
          <button
            id="mobile-sidebar-toggle"
            onClick={onToggleMobileSidebar}
            className="p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100 md:hidden"
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-base md:text-lg font-bold text-slate-900 tracking-tight leading-tight">
              {title}
            </h1>
            <div className="text-xs text-slate-500 font-medium truncate flex items-center gap-1.5 mt-0.5">
              <span>Business ID: <span className="font-semibold text-slate-700">{currentBusiness?.id ? currentBusiness.id.slice(0, 8).toUpperCase() : 'VPRO-BLR-001'}</span></span>
              <span>•</span>
              <span className="text-blue-600 font-semibold">{currentBusiness?.name || 'Main Optical Store'}</span>
            </div>
          </div>
        </div>

        {/* Right Section: Multi-Business Switcher, DB Status, User Avatar */}
        <div className="flex items-center gap-3">
          {/* Global Search Bar Button */}
          <button
            id="global-search-trigger"
            onClick={() => setIsSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs text-slate-500 hover:text-slate-700 transition-colors shadow-2xs"
            title="Global Quick Search (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden md:inline font-medium">Search Barcodes, Invoices, Parties...</span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 bg-white border border-slate-200 rounded-md">
              ⌘K
            </kbd>
          </button>

          {/* Multi-Business Switcher Dropdown */}
          <div className="relative">
            <button
              id="business-switcher-button"
              onClick={() => setIsBizDropdownOpen(!isBizDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors"
            >
              <Building2 className="w-3.5 h-3.5 text-blue-600" />
              <span className="max-w-[130px] truncate">{currentBusiness?.name || 'Select Business'}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {isBizDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsBizDropdownOpen(false)}
                />
                <div className="absolute right-0 mt-1.5 w-64 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 z-50 text-xs">
                  <div className="px-3 py-2 border-b border-slate-100 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                    Authorized Businesses ({accessibleBusinesses.length})
                  </div>
                  <div className="max-h-60 overflow-y-auto py-1">
                    {accessibleBusinesses.map(biz => (
                      <button
                        key={biz.id}
                        id={`biz-option-${biz.id}`}
                        disabled={isSwitching}
                        onClick={() => handleSelectBusiness(biz.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 text-left transition-colors ${
                          biz.id === currentBusiness?.id ? 'bg-blue-50/70 text-blue-900 font-semibold' : 'text-slate-700'
                        }`}
                      >
                        <div className="truncate">
                          <p className="truncate font-semibold">{biz.name}</p>
                          {biz.gstin && (
                            <p className="text-[10px] text-slate-400 truncate">GSTIN: {biz.gstin}</p>
                          )}
                        </div>
                        {biz.id === currentBusiness?.id && (
                          <Check className="w-4 h-4 text-blue-600 shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Database Status Button */}
          <button
            id="db-health-button"
            onClick={() => setIsDbModalOpen(true)}
            title="Inspect Database & PostgreSQL Engine"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors"
          >
            <Database className="w-3.5 h-3.5 text-emerald-600" />
            <span className="hidden sm:inline text-[11px]">PostgreSQL</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          </button>

          {/* User Profile Pill */}
          <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-200">
            <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-900 font-bold text-xs flex items-center justify-center">
              {user?.fullName ? user.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'SA'}
            </div>
            <div className="text-xs font-semibold text-slate-800 hidden lg:block">
              {user?.fullName}
            </div>
          </div>
        </div>
      </header>

      {/* Database Inspector Modal */}
      <DatabaseStatusModal
        isOpen={isDbModalOpen}
        onClose={() => setIsDbModalOpen(false)}
      />

      {/* Global Quick Search Palette Modal */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigate={onNavigate}
      />
    </>
  );
};
