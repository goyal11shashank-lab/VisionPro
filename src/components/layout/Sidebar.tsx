import React, { useState } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  RotateCcw,
  Truck,
  FileSpreadsheet,
  Boxes,
  Layers,
  QrCode,
  SlidersHorizontal,
  Users,
  Building2,
  BookOpen,
  CreditCard,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  BarChart3,
  ShieldCheck,
  KeyRound,
  Settings,
  Percent,
  Barcode,
  History,
  ChevronDown,
  ChevronRight,
  Eye,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  path: string;
  isUpcoming?: boolean;
  permission?: string;
}

interface NavSection {
  title: string;
  icon: React.ElementType;
  items: NavItem[];
  defaultOpen?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPath,
  onNavigate,
  isMobileOpen,
  onCloseMobile,
}) => {
  const { user, currentBusiness, logout, hasPermission } = useAuth();

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Sales: true,
    Purchase: false,
    Inventory: false,
    Parties: false,
    Accounts: false,
    Administration: true,
  });

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const sections: NavSection[] = [
    {
      title: 'Sales',
      icon: ShoppingCart,
      items: [
        { id: 'sales-orders', label: 'Sales Orders', icon: ShoppingCart, path: '/sales/orders', isUpcoming: true },
        { id: 'sales-invoices', label: 'Sales Invoices', icon: Receipt, path: '/sales/invoices', isUpcoming: true },
        { id: 'sales-returns', label: 'Sales Returns', icon: RotateCcw, path: '/sales/returns', isUpcoming: true },
      ],
    },
    {
      title: 'Purchase',
      icon: Truck,
      items: [
        { id: 'purchase-invoices', label: 'Purchase Invoices', icon: FileSpreadsheet, path: '/purchase/invoices', isUpcoming: true },
        { id: 'purchase-returns', label: 'Purchase Returns', icon: RotateCcw, path: '/purchase/returns', isUpcoming: true },
      ],
    },
    {
      title: 'Inventory',
      icon: Boxes,
      items: [
        { id: 'inventory-stock', label: 'Stock Register', icon: Boxes, path: '/inventory/stock', isUpcoming: true },
        { id: 'inventory-batches', label: 'Optical Batches', icon: Layers, path: '/inventory/batches', isUpcoming: true },
        { id: 'inventory-barcode', label: 'Barcode Management', icon: QrCode, path: '/inventory/barcode', isUpcoming: true },
        { id: 'inventory-adjust', label: 'Stock Adjustment', icon: SlidersHorizontal, path: '/inventory/adjustment', isUpcoming: true },
      ],
    },
    {
      title: 'Parties',
      icon: Users,
      items: [
        { id: 'parties-customers', label: 'Customers & Rx', icon: Users, path: '/parties/customers', isUpcoming: true },
        { id: 'parties-suppliers', label: 'Suppliers', icon: Building2, path: '/parties/suppliers', isUpcoming: true },
        { id: 'parties-ledger', label: 'Party Ledger', icon: BookOpen, path: '/parties/ledger', isUpcoming: true },
      ],
    },
    {
      title: 'Accounts',
      icon: CreditCard,
      items: [
        { id: 'accounts-receipts', label: 'Receipts', icon: ArrowDownLeft, path: '/accounts/receipts', isUpcoming: true },
        { id: 'accounts-payments', label: 'Payments', icon: ArrowUpRight, path: '/accounts/payments', isUpcoming: true },
        { id: 'accounts-outstanding', label: 'Outstanding Aging', icon: Clock, path: '/accounts/outstanding', isUpcoming: true },
      ],
    },
    {
      title: 'Reports',
      icon: BarChart3,
      items: [
        { id: 'reports-center', label: 'Reports & Analytics', icon: BarChart3, path: '/reports', isUpcoming: true },
      ],
    },
    {
      title: 'Administration',
      icon: ShieldCheck,
      items: [
        { id: 'admin-users', label: 'Users', icon: Users, path: '/admin/users', permission: 'admin:manage_users' },
        { id: 'admin-roles', label: 'Roles & Permissions', icon: KeyRound, path: '/admin/roles', permission: 'admin:manage_roles' },
        { id: 'admin-business', label: 'Business Settings', icon: Settings, path: '/admin/business-settings', permission: 'admin:manage_settings' },
        { id: 'admin-gst', label: 'GST Settings', icon: Percent, path: '/admin/gst-settings', permission: 'admin:manage_settings' },
        { id: 'admin-barcode', label: 'Barcode Settings', icon: Barcode, path: '/admin/barcode-settings', permission: 'admin:manage_settings' },
        { id: 'admin-audit', label: 'Audit Logs', icon: History, path: '/admin/audit-logs', permission: 'admin:view_audit_logs' },
      ],
    },
  ];

  const handleItemClick = (path: string) => {
    onNavigate(path);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          id="mobile-sidebar-backdrop"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs md:hidden"
        />
      )}

      <aside
        id="app-sidebar"
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col w-64 bg-slate-900 text-slate-200 border-r border-white/10 transition-transform duration-200 ease-in-out md:translate-x-0 md:static shrink-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/5 bg-slate-950/40">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500 text-white font-bold text-base shadow-sm shrink-0">
            V
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-white tracking-tight truncate text-sm">
              {currentBusiness?.name || 'VisionPro ERP'}
            </span>
            <span className="text-[11px] text-slate-400 font-normal truncate">
              {currentBusiness?.tradeName || 'Optical Solutions'}
            </span>
          </div>
        </div>

        {/* Navigation List */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1 custom-scrollbar-dark">
          {/* Dashboard Item */}
          <button
            id="nav-dashboard"
            onClick={() => handleItemClick('/')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-all ${
              currentPath === '/'
                ? 'bg-white/10 text-white font-semibold border-l-[3px] border-blue-500 pl-2.5'
                : 'text-slate-300/80 hover:bg-white/5 hover:text-white'
            }`}
          >
            <LayoutDashboard className={`w-4 h-4 shrink-0 ${currentPath === '/' ? 'text-blue-400' : 'text-slate-400'}`} />
            <span>Dashboard</span>
          </button>

          {/* Collapsible Module Sections */}
          {sections.map(section => {
            const isOpen = !!openSections[section.title];
            const SectionIcon = section.icon;

            return (
              <div key={section.title} className="pt-2">
                <button
                  type="button"
                  onClick={() => toggleSection(section.title)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-white/40 hover:text-white/70 tracking-wider uppercase transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <SectionIcon className="w-3.5 h-3.5 opacity-80" />
                    <span>{section.title}</span>
                  </div>
                  {isOpen ? (
                    <ChevronDown className="w-3 h-3 text-slate-500" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-slate-500" />
                  )}
                </button>

                {isOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    {section.items.map(item => {
                      const ItemIcon = item.icon;
                      const isActive = currentPath === item.path;

                      // Permission check (if specified)
                      if (item.permission && !hasPermission(item.permission)) {
                        return null;
                      }

                      return (
                        <button
                          key={item.id}
                          id={`nav-${item.id}`}
                          onClick={() => handleItemClick(item.path)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all group ${
                            isActive
                              ? 'bg-white/10 text-white font-semibold border-l-[3px] border-blue-500 pl-2.5'
                              : 'text-slate-300/70 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <ItemIcon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-200'}`} />
                            <span className="truncate">{item.label}</span>
                          </div>
                          {item.isUpcoming && (
                            <span className="shrink-0 text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full bg-white/10 text-slate-300 border border-white/5">
                              Next
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* System Info Box & User Footer */}
        <div className="border-t border-white/10 bg-slate-950/60">
          {/* Live System Info Status Bar */}
          <div className="p-3 bg-white/[0.02] border-b border-white/5 text-[11px] text-white/50 space-y-1 font-mono">
            <div className="flex items-center justify-between">
              <span className="text-white/40">Status</span>
              <span className="text-emerald-400 font-sans flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Online
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/40">Instance</span>
              <span className="text-slate-300">Production-01</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/40">Database</span>
              <span className="text-slate-300">PostgreSQL</span>
            </div>
          </div>

          {/* User Account Bar */}
          <div className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-full bg-slate-800 border border-white/10 text-white flex items-center justify-center font-bold text-xs shrink-0">
                {user?.fullName?.charAt(0) || 'U'}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-white truncate">
                  {user?.fullName}
                </span>
                <span className="text-[10px] text-slate-400 truncate">
                  {user?.isSuperAdmin ? 'Super Administrator' : user?.roles?.[0]?.name || 'Standard User'}
                </span>
              </div>
            </div>
            <button
              id="sidebar-logout-button"
              onClick={logout}
              title="Log Out"
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-white/5 rounded-md transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
