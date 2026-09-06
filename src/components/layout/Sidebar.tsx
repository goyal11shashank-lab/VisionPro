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
  subItems?: {
    id: string;
    label: string;
    icon: React.ElementType;
    path: string;
    permission?: string;
  }[];
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

  const [openSection, setOpenSection] = useState<string | null>('Master Data');
  const [openSubNav, setOpenSubNav] = useState<string | null>('sales-create-invoice');

  const toggleSection = (section: string) => {
    setOpenSection(prev => (prev === section ? null : section));
  };

  const toggleSubNav = (itemId: string) => {
    setOpenSubNav(prev => (prev === itemId ? null : itemId));
  };

  const sections: NavSection[] = [
    {
      title: 'Master Data',
      icon: Layers,
      items: [
        { id: 'master-categories', label: 'Categories', icon: Layers, path: '/master/categories', permission: 'master:view' },
        { id: 'master-bases', label: 'Bases & Compatibility', icon: Boxes, path: '/master/bases', permission: 'master:view' },
        { id: 'master-coatings', label: 'Coatings', icon: Sparkles, path: '/master/coatings', permission: 'master:view' },
        { id: 'master-primary-items', label: 'Primary Items', icon: BookOpen, path: '/master/primary-items', permission: 'master:view' },
        { id: 'master-stock-items', label: 'Stock Items', icon: QrCode, path: '/master/stock-items', permission: 'master:view' },
        { id: 'master-batches', label: 'Optical Batches & Powers', icon: Barcode, path: '/master/batches', permission: 'master:view' },
      ],
    },
    {
      title: 'Sales',
      icon: ShoppingCart,
      items: [
        {
          id: 'sales-create-invoice',
          label: 'Create Sales Invoice',
          icon: Receipt,
          path: '/sales/pos',
          permission: 'sales:view',
          subItems: [
            { id: 'sales-pos', label: 'POS', icon: Sparkles, path: '/sales/pos', permission: 'sales:view' },
            { id: 'sales-normal-voucher', label: 'Normal Sales Voucher', icon: FileSpreadsheet, path: '/sales/voucher/new', permission: 'sales:view' },
          ],
        },
        { id: 'sales-invoices', label: 'Sales Invoices Register', icon: Receipt, path: '/sales/invoices', permission: 'sales:view' },
        { id: 'sales-orders', label: 'Sales Orders', icon: ShoppingCart, path: '/sales/orders', permission: 'sales:view' },
        { id: 'sales-returns', label: 'Sales Returns', icon: RotateCcw, path: '/sales/returns', permission: 'sales:view' },
        { id: 'sales-ledger', label: 'Customer Ledger', icon: BookOpen, path: '/sales/customer-ledger', permission: 'sales:view' },
      ],
    },
    {
      title: 'Purchase',
      icon: Truck,
      items: [
        { id: 'purchase-voucher', label: 'Normal Purchase Voucher', icon: FileSpreadsheet, path: '/purchase/voucher/new', permission: 'purchase:view' },
        { id: 'purchase-invoices', label: 'Purchase Invoices Register', icon: Receipt, path: '/purchase/invoices', permission: 'purchase:view' },
        { id: 'purchase-returns', label: 'Purchase Returns', icon: RotateCcw, path: '/purchase/returns', permission: 'purchase:view' },
        { id: 'purchase-lots', label: 'Purchase Lots & Costing', icon: Layers, path: '/purchase/lots', permission: 'purchase:view' },
      ],
    },
    {
      title: 'Inventory',
      icon: Boxes,
      items: [
        { id: 'inventory-stock', label: 'Inventory Stock Matrix', icon: Boxes, path: '/reports/inventory', permission: 'inventory:view' },
        { id: 'inventory-stock-ledger', label: 'Stock Movement Ledger', icon: Layers, path: '/reports/stock-ledger', permission: 'inventory:view' },
        { id: 'inventory-batches', label: 'Optical Batches & Barcodes', icon: Barcode, path: '/master/batches', permission: 'master:view' },
      ],
    },
    {
      title: 'Parties',
      icon: Users,
      items: [
        { id: 'parties-all', label: 'Party Master', icon: Users, path: '/parties', permission: 'parties:view' },
        { id: 'parties-suppliers', label: 'Suppliers', icon: Building2, path: '/parties/suppliers', permission: 'parties:view' },
        { id: 'parties-customers', label: 'Customers', icon: Users, path: '/parties/customers', permission: 'parties:view' },
        { id: 'parties-ledger', label: 'Supplier Ledger', icon: BookOpen, path: '/parties/ledger', permission: 'parties:view' },
      ],
    },
    {
      title: 'Accounts',
      icon: CreditCard,
      items: [
        { id: 'accounts-receipts', label: 'Receipts', icon: ArrowDownLeft, path: '/accounts/receipts', permission: 'payment.receipt.view' },
        { id: 'accounts-payments', label: 'Payments', icon: ArrowUpRight, path: '/accounts/payments', permission: 'payment.supplier.view' },
        { id: 'accounts-outstanding', label: 'Outstanding Aging', icon: Clock, path: '/accounts/outstanding', permission: 'accounts:view' },
      ],
    },
    {
      title: 'Reports & Analytics',
      icon: BarChart3,
      items: [
        { id: 'reports-inventory', label: 'Stock Matrix Report', icon: Boxes, path: '/reports/inventory', permission: 'reports:view' },
        { id: 'reports-stock-ledger', label: 'Stock Ledger Register', icon: Layers, path: '/reports/stock-ledger', permission: 'reports:view' },
        { id: 'reports-sales', label: 'Sales Register & Returns', icon: Receipt, path: '/reports/sales', permission: 'reports:view' },
        { id: 'reports-purchases', label: 'Purchase Register & Returns', icon: Truck, path: '/reports/purchases', permission: 'reports:view' },
        { id: 'reports-outstanding', label: 'Outstanding Aging Report', icon: Clock, path: '/reports/outstanding', permission: 'reports:view' },
        { id: 'reports-party-statement', label: 'Party Statement (Ledger)', icon: BookOpen, path: '/reports/party-statement', permission: 'reports:view' },
        { id: 'reports-payments', label: 'Payment & Receipt Register', icon: CreditCard, path: '/reports/payments', permission: 'reports:view' },
        { id: 'reports-analytics', label: 'Product & Power Analytics', icon: BarChart3, path: '/reports/analytics', permission: 'reports:view' },
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
            const isOpen = openSection === section.title;
            const SectionIcon = section.icon;

            return (
              <div key={section.title} className="pt-2">
                <button
                  type="button"
                  onClick={() => toggleSection(section.title)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-bold tracking-wide rounded-lg transition-all border ${
                    isOpen
                      ? 'bg-gradient-to-r from-blue-950/80 to-slate-800/90 text-white border-blue-500/40 shadow-sm'
                      : 'bg-slate-800/40 hover:bg-slate-800/80 text-slate-200 hover:text-white border-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`p-1 rounded-md transition-colors ${isOpen ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-700/60 text-blue-400'}`}>
                      <SectionIcon className="w-3.5 h-3.5" />
                    </div>
                    <span className="uppercase text-[11px] font-bold tracking-wider">{section.title}</span>
                  </div>
                  {isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-blue-400 transition-transform" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 transition-transform" />
                  )}
                </button>

                {isOpen && (
                  <div className="mt-1 space-y-0.5 px-0.5">
                    {section.items.map(item => {
                      const ItemIcon = item.icon;
                      const hasSub = item.subItems && item.subItems.length > 0;
                      const isSubOpen = hasSub ? openSubNav === item.id : false;
                      const isParentActive = hasSub
                        ? item.subItems?.some(s => currentPath === s.path)
                        : (currentPath === item.path || (item.path === '/master/stock-items' && (currentPath === '/master/unique-items' || currentPath === '/unique-items' || currentPath === '/stock-items')));

                      // Permission check (if specified)
                      if (item.permission && !hasPermission(item.permission)) {
                        return null;
                      }

                      if (hasSub) {
                        return (
                          <div key={item.id} className="space-y-0.5">
                            <button
                              id={`nav-${item.id}`}
                              onClick={() => toggleSubNav(item.id)}
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all group ${
                                isParentActive
                                  ? 'bg-white/10 text-white font-semibold'
                                  : 'text-slate-300/80 hover:bg-white/5 hover:text-white'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 truncate">
                                <ItemIcon className={`w-3.5 h-3.5 shrink-0 ${isParentActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-200'}`} />
                                <span className="truncate">{item.label}</span>
                              </div>
                              {isSubOpen ? (
                                <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                              )}
                            </button>

                            {isSubOpen && (
                              <div className="pl-6 space-y-0.5 border-l border-white/10 ml-4 my-0.5">
                                {item.subItems?.map(sub => {
                                  const SubIcon = sub.icon;
                                  const isSubActive = currentPath === sub.path;
                                  if (sub.permission && !hasPermission(sub.permission)) return null;

                                  return (
                                    <button
                                      key={sub.id}
                                      id={`nav-${sub.id}`}
                                      onClick={() => handleItemClick(sub.path)}
                                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11px] transition-all group ${
                                        isSubActive
                                          ? 'bg-blue-600/30 text-blue-300 font-semibold border-l-2 border-blue-400 pl-2'
                                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2 truncate">
                                        <SubIcon className={`w-3 h-3 shrink-0 ${isSubActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                                        <span className="truncate">{sub.label}</span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }

                      return (
                        <button
                          key={item.id}
                          id={`nav-${item.id}`}
                          onClick={() => handleItemClick(item.path)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all group ${
                            isParentActive
                              ? 'bg-white/10 text-white font-semibold border-l-[3px] border-blue-500 pl-2.5'
                              : 'text-slate-300/70 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <ItemIcon className={`w-3.5 h-3.5 shrink-0 ${isParentActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-200'}`} />
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
              <span className="text-slate-300">Neon PostgreSQL</span>
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
