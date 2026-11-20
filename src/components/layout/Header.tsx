import React, { useState } from 'react';
import {
  Menu,
  Building2,
  ChevronDown,
  Check,
  Search,
  Store,
  X,
  CheckCircle2,
  ShieldCheck,
  Link2,
  Lock,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { useUnsavedChanges } from '../../context/UnsavedChangesContext.js';
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
  const { user, currentBusiness, accessibleBusinesses, switchBusiness, roles } = useAuth();
  const dropdownBusinesses=(accessibleBusinesses||[]).filter(b=>!user?.isSuperAdmin||!b.hiddenFromSuperAdmin);
  const { confirmAction } = useUnsavedChanges();
  const [isBizDropdownOpen, setIsBizDropdownOpen] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isSwitching, setIsSwitching] = useState<boolean>(false);

  const handleSelectBusiness = async (bizId: string) => {
    if (bizId === currentBusiness?.id) {
      setIsBizDropdownOpen(false);
      return;
    }
    confirmAction(async () => {
      setIsSwitching(true);
      try {
        await switchBusiness(bizId);
      } finally {
        setIsSwitching(false);
        setIsBizDropdownOpen(false);
      }
    }, 'Switching business will discard your unsaved changes. Do you wish to leave?');
  };

  const userInitials = user?.fullName
    ? user.fullName
        .split(' ')
        .filter(Boolean)
        .map(n => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'SA';

  const userRoleDisplay = user?.isSuperAdmin
    ? 'Super Administrator'
    : roles?.[0]?.name || 'Standard User';

  return (
    <>
      <header
        id="app-header"
        className="sticky top-0 z-30 flex items-center justify-between h-14 sm:h-15 px-4 sm:px-6 lg:px-8 bg-white border-b border-slate-200 shrink-0"
      >
        {/* Left Section: Mobile Toggle & Page Title / Business Context */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 sm:flex-none sm:shrink-0">
          <button
            id="mobile-sidebar-toggle"
            onClick={onToggleMobileSidebar}
            className="p-1.5 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100 md:hidden cursor-pointer"
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex flex-col min-w-0">
            <h1 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight leading-tight truncate">
              {title}
            </h1>
            <div className="text-[11px] text-slate-500 font-medium truncate flex items-center gap-1.5">
              <span>
                ID:{' '}
                <span className="font-semibold text-slate-700">
                  {currentBusiness?.id ? currentBusiness.id.slice(0, 8).toUpperCase() : 'VPRO-BLR-001'}
                </span>
              </span>
              <span className="text-slate-300 hidden sm:inline">•</span>
              <span className="text-blue-600 font-semibold truncate hidden sm:inline">
                {currentBusiness?.name || 'Main Optical Store'}
                {user?.assignedGodown ? ` — ${user.assignedGodown.name}` : ''}
              </span>
              {user?.assignedGodown ? (
                <span className="hidden sm:inline px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300 shrink-0">
                  Legacy scope
                </span>
              ) : (
                <span className="hidden sm:inline px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-100 text-blue-800 border border-blue-200 shrink-0">
                  BUSINESS
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center: Global Search Bar taking available width */}
        <div className="flex-1 max-w-xl mx-3 sm:mx-6 lg:mx-8 hidden sm:flex items-center min-w-0">
          <button
            id="global-search-trigger"
            onClick={() => setIsSearchOpen(true)}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 text-xs text-slate-500 hover:text-slate-700 transition-all shadow-2xs group cursor-pointer"
            title="Global Quick Search (Ctrl+K)"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Search className="w-3.5 h-3.5 text-blue-600 shrink-0 group-hover:scale-105 transition-transform" />
              <span className="font-medium truncate text-slate-500">
                Search Barcodes, Invoices, Optical Batches, Parties...
              </span>
            </div>
            <kbd className="hidden md:inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 bg-white border border-slate-200 rounded shadow-2xs shrink-0">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right Section: Mobile Search Trigger, Multi-Business Selector, User Identity */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Mobile Search Button */}
          <button
            id="global-search-trigger-mobile"
            onClick={() => setIsSearchOpen(true)}
            className="sm:hidden p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 cursor-pointer"
            title="Global Quick Search"
          >
            <Search className="w-4 h-4 text-blue-600" />
          </button>

          {/* Multi-Business Switcher Dropdown (or Locked Godown Badge) */}
          {user?.assignedGodown ? (
            <div
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-800 select-none"
              title={`Legacy stock assignment: ${user.assignedGodown.name}. Multi-business switching restricted.`}
            >
              <Building2 className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="max-w-[78px] sm:max-w-[170px] truncate">
                {user.assignedGodown.name}
              </span>
              <Lock className="w-3 h-3 text-amber-500 shrink-0" />
            </div>
          ) : (
            <div className="relative">
              <button
                id="business-switcher-button"
                onClick={() => setIsBizDropdownOpen(!isBizDropdownOpen)}
                className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                <Building2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="max-w-[78px] sm:max-w-[170px] truncate">
                  {currentBusiness?.name || 'Select Business'}
                </span>
                <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
              </button>

            {isBizDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsBizDropdownOpen(false)}
                />
                <div className="absolute right-0 mt-1.5 w-64 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 z-50 text-xs">
                  <div className="px-3 py-2 border-b border-slate-100 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                    Authorized Businesses ({dropdownBusinesses.length})
                  </div>
                  <div className="max-h-60 overflow-y-auto py-1">
                    {dropdownBusinesses.map(biz => (
                      <button
                        key={biz.id}
                        id={`biz-option-${biz.id}`}
                        disabled={isSwitching}
                        onClick={() => handleSelectBusiness(biz.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 text-left transition-colors cursor-pointer ${
                          biz.id === currentBusiness?.id ? 'bg-blue-50/70 text-blue-900 font-semibold' : 'text-slate-700'
                        }`}
                      >
                        <div className="truncate flex-1 min-w-0 pr-2">
                          <div className="flex items-center gap-1.5 truncate">
                            <p className="truncate font-semibold">{biz.name}</p>
                            {biz.businessType === 'DEALER' ? (
                              <span className="hidden sm:inline px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-100 text-purple-800 border border-purple-200 shrink-0">
                                BUSINESS
                              </span>
                            ) : (
                              <span className="hidden sm:inline px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-100 text-blue-800 border border-blue-200 shrink-0">
                                BUSINESS
                              </span>
                            )}
                          </div>
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
        )}

          {/* User Control (Avatar + User Name / Role) */}
          <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-slate-200">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-slate-800 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs">
              {userInitials}
            </div>
            <div className="text-xs hidden md:block leading-tight">
              <div className="font-semibold text-slate-800 truncate max-w-[120px] lg:max-w-[160px]">
                {user?.fullName || 'Super Administrator'}
              </div>
              <div className="text-[10px] text-slate-500 capitalize truncate max-w-[120px] lg:max-w-[160px]">
                {userRoleDisplay}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Global Quick Search Palette Modal */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigate={onNavigate}
      />


    </>
  );
};
